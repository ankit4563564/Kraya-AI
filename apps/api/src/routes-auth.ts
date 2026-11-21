import type { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { GstRegime, TurnoverBand, validateGstin } from '@kraya/finance-engine';
import { OutreachLanguage, sendViaResendEmail } from '@kraya/agent-core';
import { getDb, KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  generateSecureToken,
  hashPassword,
  parseCookies,
  SESSION_COOKIE_NAME,
  sha256Hex,
  verifyPassword,
} from './auth.js';
import { AppHelpers, AppVariables, isHttpsRequest, recordAuditLog, uid } from './context.js';
import { extractClientIp, SlidingWindowRateLimiter } from './security.js';

const failedLoginLimiter = new SlidingWindowRateLimiter();

const VALID_ROLES = new Set(['owner', 'clerk', 'ca']);

async function getUserWorkspaces(db: KrayaDb, userId: string) {
  const memberships = await db
    .select({
      membershipId: schema.workspaceMemberships.id,
      workspaceId: schema.workspaceMemberships.workspaceId,
      role: schema.workspaceMemberships.role,
      legalName: schema.workspaces.legalName,
      gstin: schema.workspaces.gstin,
      stateCode: schema.workspaces.stateCode,
      onboardingCompletedAt: schema.workspaces.onboardingCompletedAt,
    })
    .from(schema.workspaceMemberships)
    .innerJoin(schema.workspaces, eq(schema.workspaceMemberships.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMemberships.userId, userId));

  return memberships;
}

export function registerAuthAndTeamRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // =========================================================================
  // SIGNUP (Creates Workspace + Owner User + Membership + HTTP-only Cookie)
  // =========================================================================
  app.post('/api/auth/signup', async (c) => {
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      name: string;
      email: string;
      password: string;
      companyName: string;
      gstin?: string;
      stateCode?: string;
      dpdpConsentAccepted: boolean;
    }>();

    if (!body.dpdpConsentAccepted) {
      return c.json(
        { error: 'Explicit DPDP Act 2023 data processing consent is required to sign up.' },
        400
      );
    }
    if (
      !body.name?.trim() ||
      !body.email?.includes('@') ||
      (body.password || '').length < 8 ||
      !body.companyName?.trim()
    ) {
      return c.json(
        { error: 'Valid full name, company name, email, and password (min 8 chars) are required.' },
        400
      );
    }

    const emailNorm = body.email.trim().toLowerCase();
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, emailNorm))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: 'An account with this email already exists.' }, 409);
    }

    let stateCode = body.stateCode?.trim() || '29';
    let gstinNorm: string | null = null;
    if (body.gstin?.trim()) {
      const check = validateGstin(body.gstin);
      if (!check.valid) return c.json({ error: 'Invalid GSTIN', details: check.errors }, 400);
      gstinNorm = check.normalized;
      stateCode = check.stateCode || stateCode;
    }

    const wsId = uid('ws');
    const userId = uid('usr');
    const passwordHash = await hashPassword(body.password);

    const [createdWs] = await db
      .insert(schema.workspaces)
      .values({
        id: wsId,
        legalName: body.companyName.trim(),
        gstin: gstinNorm,
        stateCode,
        gstRegime: 'regular',
        waccPct: 15.0,
        turnoverBand: 'under_5cr',
        defaultOutreachLang: 'english',
        primaryContactName: body.name.trim(),
        primaryContactEmail: emailNorm,
        onboardingCompletedAt: null,
      })
      .returning();

    await db.insert(schema.users).values({
      id: userId,
      workspaceId: wsId,
      name: body.name.trim(),
      email: emailNorm,
      passwordHash,
      role: 'owner',
    });

    await db.insert(schema.workspaceMemberships).values({
      id: uid('mem'),
      workspaceId: wsId,
      userId,
      role: 'owner',
    });

    const token = generateSecureToken(32);
    const ttlSeconds = helpers.getSessionTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db.insert(schema.sessions).values({
      token,
      userId,
      workspaceId: wsId,
      role: 'owner',
      expiresAt,
      lastSeenAt: new Date(),
    });

    await recordAuditLog(
      db,
      { workspaceId: wsId, email: emailNorm, role: 'owner' },
      'auth_signup',
      'workspace',
      wsId,
      { dpdpConsent: true, stateCode }
    );

    const secureCookie = helpers.isProduction() || isHttpsRequest(c);
    c.header('Set-Cookie', buildSessionCookie(token, { maxAgeSeconds: ttlSeconds, secure: secureCookie }));

    return c.json(
      {
        token,
        user: {
          id: userId,
          name: body.name.trim(),
          email: emailNorm,
          role: 'owner',
          workspaceId: wsId,
        },
        workspace: createdWs,
        needsOnboarding: true,
      },
      201
    );
  });

  // =========================================================================
  // LOGIN (Sets HTTP-only Cookie + returns user/workspaces)
  // =========================================================================
  app.post('/api/auth/login', async (c) => {
    const ip = extractClientIp(c.req.raw.headers);
    const failStatus = failedLoginLimiter.peek(`login_fail:${ip}`, 10, 60_000);
    if (!failStatus.allowed) {
      c.header('Retry-After', String(failStatus.retryAfterSeconds));
      return c.json(
        { error: 'Too many failed login attempts. Please wait 1 minute before trying again.' },
        429
      );
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{ email: string; password: string }>();
    const emailNorm = (body.email || '').trim().toLowerCase();

    const [usr] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, emailNorm))
      .limit(1);

    if (!usr || !(await verifyPassword(body.password || '', usr.passwordHash))) {
      failedLoginLimiter.record(`login_fail:${ip}`);
      return c.json({ error: 'Invalid email or password.' }, 401);
    }

    failedLoginLimiter.reset(`login_fail:${ip}`);

    const memberships = await getUserWorkspaces(db, usr.id);
    const activeMembership =
      memberships.find((m) => m.workspaceId === usr.workspaceId) || memberships[0];
    const activeWsId = activeMembership?.workspaceId ?? usr.workspaceId;
    const activeRole = (activeMembership?.role ?? usr.role) as 'owner' | 'clerk' | 'ca';

    const token = generateSecureToken(32);
    const ttlSeconds = helpers.getSessionTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db.insert(schema.sessions).values({
      token,
      userId: usr.id,
      workspaceId: activeWsId,
      role: activeRole,
      expiresAt,
      lastSeenAt: new Date(),
    });

    await recordAuditLog(
      db,
      { workspaceId: activeWsId, email: usr.email, role: activeRole },
      'auth_login',
      'user',
      usr.id
    );

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, activeWsId))
      .limit(1);

    const secureCookie = helpers.isProduction() || isHttpsRequest(c);
    c.header('Set-Cookie', buildSessionCookie(token, { maxAgeSeconds: ttlSeconds, secure: secureCookie }));

    return c.json({
      token,
      user: {
        id: usr.id,
        name: usr.name,
        email: usr.email,
        role: activeRole,
        workspaceId: activeWsId,
      },
      workspace: ws ?? null,
      workspaces: memberships,
      needsOnboarding: ws ? !ws.onboardingCompletedAt : false,
    });
  });

  // =========================================================================
  // LOGOUT (Deletes Session & Clears HTTP-only Cookie)
  // =========================================================================
  app.post('/api/auth/logout', async (c) => {
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const cookies = parseCookies(c.req.header('cookie'));
    const authHeader = c.req.header('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = cookies[SESSION_COOKIE_NAME] || bearer;

    if (token) {
      await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    }
    const secureCookie = helpers.isProduction() || isHttpsRequest(c);
    c.header('Set-Cookie', buildClearSessionCookie(secureCookie));
    return c.json({ ok: true });
  });

  // =========================================================================
  // CURRENT SESSION & WORKSPACE LIST (/api/auth/me)
  // =========================================================================
  app.get('/api/auth/me', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);

    const workspaces = ctx.userId ? await getUserWorkspaces(db, ctx.userId) : [];

    return c.json({
      authenticated: ctx.authenticated,
      requireAuthMode: helpers.isAuthRequired(),
      user: ctx.userId
        ? {
            id: ctx.userId,
            name: ctx.userName,
            email: ctx.email,
            role: ctx.role,
            workspaceId: ctx.workspaceId,
          }
        : null,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      email: ctx.email,
      workspace: ws ?? null,
      workspaces,
      needsOnboarding: ctx.authenticated && ctx.role === 'owner' && ws ? !ws.onboardingCompletedAt : false,
    });
  });

  // =========================================================================
  // WORKSPACE SWITCHING (For Users / CAs with Multiple Companies)
  // =========================================================================
  app.get('/api/auth/workspaces', async (c) => {
    const ctx = c.get('auth');
    if (!ctx.userId) return c.json([]);
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    return c.json(await getUserWorkspaces(db, ctx.userId));
  });

  app.post('/api/auth/switch-workspace', async (c) => {
    const ctx = c.get('auth');
    if (!ctx.userId || !ctx.sessionToken) {
      return c.json({ error: 'Authenticated session required to switch workspaces.' }, 401);
    }
    const body = await c.req.json<{ workspaceId?: string }>();
    if (!body.workspaceId) return c.json({ error: 'workspaceId is required.' }, 400);

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [membership] = await db
      .select()
      .from(schema.workspaceMemberships)
      .where(
        and(
          eq(schema.workspaceMemberships.userId, ctx.userId),
          eq(schema.workspaceMemberships.workspaceId, body.workspaceId)
        )
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'You do not have access to the requested workspace.' }, 403);
    }

    await db
      .update(schema.sessions)
      .set({
        workspaceId: membership.workspaceId,
        role: membership.role,
        lastSeenAt: new Date(),
      })
      .where(eq(schema.sessions.token, ctx.sessionToken));

    await db
      .update(schema.users)
      .set({ workspaceId: membership.workspaceId, role: membership.role })
      .where(eq(schema.users.id, ctx.userId));

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, membership.workspaceId))
      .limit(1);

    await recordAuditLog(
      db,
      { workspaceId: membership.workspaceId, email: ctx.email, role: membership.role as 'owner' | 'clerk' | 'ca' },
      'workspace_switched',
      'workspace',
      membership.workspaceId
    );

    return c.json({
      ok: true,
      workspaceId: membership.workspaceId,
      role: membership.role,
      workspace: ws ?? null,
    });
  });

  // =========================================================================
  // FORGOT PASSWORD & PASSWORD RESET (Anti-Enumeration + Token Hashing)
  // =========================================================================
  app.post('/api/auth/forgot-password', async (c) => {
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{ email?: string }>();
    const emailNorm = (body.email || '').trim().toLowerCase();

    const genericResponse: Record<string, unknown> = {
      ok: true,
      message: 'If an account exists for that email, password reset instructions have been issued.',
    };

    if (!emailNorm || !emailNorm.includes('@')) {
      return c.json(genericResponse);
    }

    const [usr] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, emailNorm))
      .limit(1);

    if (!usr) {
      return c.json(genericResponse);
    }

    const rawToken = generateSecureToken(32);
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.insert(schema.passwordResetTokens).values({
      id: uid('rst'),
      userId: usr.id,
      tokenHash,
      expiresAt,
    });

    await recordAuditLog(
      db,
      { workspaceId: usr.workspaceId, email: usr.email, role: usr.role as 'owner' | 'clerk' | 'ca' },
      'password_reset_requested',
      'user',
      usr.id
    );

    const appOrigin = (helpers.getEnv('APP_ORIGIN') || 'http://localhost:5173').split(',')[0].trim();
    const resetLink = `${appOrigin}/?reset=${encodeURIComponent(rawToken)}`;

    const resendKey = helpers.getEnv('RESEND_API_KEY');
    const fromEmail = helpers.getEnv('RESEND_FROM_EMAIL') || 'security@kraya.in';
    if (resendKey) {
      try {
        await sendViaResendEmail({
          apiKey: resendKey,
          fromEmail,
          toEmail: usr.email,
          subject: 'Reset your Kraya password (valid 30 minutes)',
          bodyText: `Hello ${usr.name},\n\nUse this secure link within 30 minutes to reset your Kraya password:\n${resetLink}\n\nIf you did not request this, you can safely ignore this email.`,
        });
        genericResponse.emailDispatched = true;
      } catch {
        genericResponse.emailDispatched = false;
      }
    } else if (!helpers.isProduction()) {
      // Dev-only convenience when Resend is unconfigured; NEVER exposed in production
      genericResponse.emailDispatched = false;
      genericResponse.devResetToken = rawToken;
      genericResponse.devResetPath = `/?reset=${encodeURIComponent(rawToken)}`;
    }

    return c.json(genericResponse);
  });

  app.post('/api/auth/reset-password', async (c) => {
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{ token?: string; newPassword?: string }>();
    const rawToken = (body.token || '').trim();
    const newPassword = body.newPassword || '';

    if (!rawToken || newPassword.length < 8) {
      return c.json({ error: 'Valid reset token and new password (min 8 chars) are required.' }, 400);
    }

    const tokenHash = await sha256Hex(rawToken);
    const [row] = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      return c.json({ error: 'Password reset link is invalid or has expired.' }, 400);
    }

    const [usr] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1);
    if (!usr) return c.json({ error: 'Account not found.' }, 404);

    const newHash = await hashPassword(newPassword);
    await db.update(schema.users).set({ passwordHash: newHash }).where(eq(schema.users.id, usr.id));
    await db
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResetTokens.id, row.id));
    // Revoke all existing sessions on password reset
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, usr.id));

    await recordAuditLog(
      db,
      { workspaceId: usr.workspaceId, email: usr.email, role: usr.role as 'owner' | 'clerk' | 'ca' },
      'password_reset_completed',
      'user',
      usr.id
    );

    return c.json({ ok: true, message: 'Password updated successfully. Please sign in with your new password.' });
  });

  // =========================================================================
  // COMPANY ONBOARDING (8 Required Indian SMB Fields + Offline GSTIN Parse)
  // =========================================================================
  app.put('/api/workspace/onboarding', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can complete company onboarding.' }, 403);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      legalName: string;
      gstin?: string | null;
      gstRegime: GstRegime;
      stateCode: string;
      turnoverBand: TurnoverBand;
      waccPct: number;
      businessAddress: string;
      primaryContactName: string;
      primaryContactPhone: string;
      primaryContactEmail: string;
      defaultOutreachLang?: OutreachLanguage;
    }>();

    if (!body.legalName?.trim()) {
      return c.json({ error: 'Company legal name is required.' }, 400);
    }
    if (!['regular', 'composition', 'unregistered'].includes(body.gstRegime)) {
      return c.json({ error: 'Valid GST registration type (regular, composition, unregistered) required.' }, 400);
    }
    if (!/^\d{2}$/.test((body.stateCode || '').trim())) {
      return c.json({ error: 'Valid 2-digit Indian GST State Code is required (e.g. 29 for Karnataka).' }, 400);
    }
    if (!Number.isFinite(body.waccPct) || body.waccPct < 0 || body.waccPct > 48) {
      return c.json({ error: 'Default WACC percentage must be between 0% and 48%.' }, 400);
    }
    if (!body.businessAddress?.trim() || !body.primaryContactName?.trim() || !body.primaryContactPhone?.trim()) {
      return c.json({ error: 'Business address and primary contact name & phone are required.' }, 400);
    }

    let normalizedGstin: string | null = null;
    let resolvedState = body.stateCode.trim();
    if (body.gstRegime !== 'unregistered' && body.gstin?.trim()) {
      const check = validateGstin(body.gstin);
      if (!check.valid) {
        return c.json({ error: 'Invalid Company GSTIN', details: check.errors }, 400);
      }
      normalizedGstin = check.normalized;
      // Use user's verified stateCode if explicitly provided, else GSTIN stateCode
      resolvedState = resolvedState || check.stateCode || '29';
    } else if (body.gstRegime === 'regular' && !body.gstin?.trim()) {
      // Allow regular businesses waiting on GSTIN or explicitly warn? User can leave GSTIN blank if pending, never invent one.
      normalizedGstin = null;
    }

    const [updated] = await db
      .update(schema.workspaces)
      .set({
        legalName: body.legalName.trim(),
        gstin: normalizedGstin,
        gstRegime: body.gstRegime,
        stateCode: resolvedState,
        turnoverBand: body.turnoverBand || 'under_5cr',
        waccPct: body.waccPct,
        businessAddress: body.businessAddress.trim(),
        primaryContactName: body.primaryContactName.trim(),
        primaryContactPhone: body.primaryContactPhone.trim(),
        primaryContactEmail: (body.primaryContactEmail || ctx.email).trim().toLowerCase(),
        ...(body.defaultOutreachLang ? { defaultOutreachLang: body.defaultOutreachLang } : {}),
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .returning();

    await recordAuditLog(db, ctx, 'company_onboarding_completed', 'workspace', ctx.workspaceId, {
      gstRegime: updated.gstRegime,
      stateCode: updated.stateCode,
      turnoverBand: updated.turnoverBand,
      waccPct: updated.waccPct,
    });

    return c.json(updated);
  });

  // =========================================================================
  // TEAM MANAGEMENT & TOKEN-BASED INVITATIONS (Owner / Purchase Clerk / CA)
  // =========================================================================
  app.get('/api/team/members', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const members = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.workspaceMemberships.role,
        joinedAt: schema.workspaceMemberships.createdAt,
      })
      .from(schema.workspaceMemberships)
      .innerJoin(schema.users, eq(schema.workspaceMemberships.userId, schema.users.id))
      .where(eq(schema.workspaceMemberships.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.workspaceMemberships.createdAt));

    return c.json(members);
  });

  app.get('/api/team/invitations', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can view team invitations.' }, 403);
    }
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const invites = await db
      .select({
        id: schema.workspaceInvitations.id,
        email: schema.workspaceInvitations.email,
        name: schema.workspaceInvitations.name,
        role: schema.workspaceInvitations.role,
        expiresAt: schema.workspaceInvitations.expiresAt,
        acceptedAt: schema.workspaceInvitations.acceptedAt,
        revokedAt: schema.workspaceInvitations.revokedAt,
        createdAt: schema.workspaceInvitations.createdAt,
      })
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.workspaceInvitations.createdAt));

    return c.json(invites);
  });

  app.post('/api/team/invitations', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can invite team members.' }, 403);
    }
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      email: string;
      name?: string;
      role: 'owner' | 'clerk' | 'ca';
      expiresInHours?: number;
    }>();

    const emailNorm = (body.email || '').trim().toLowerCase();
    if (!emailNorm.includes('@')) {
      return c.json({ error: 'Valid invitee email address is required.' }, 400);
    }
    if (!VALID_ROLES.has(body.role)) {
      return c.json({ error: 'Role must be owner, clerk, or ca.' }, 400);
    }

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);

    const rawToken = generateSecureToken(24);
    const tokenHash = await sha256Hex(rawToken);
    const hours =
      typeof body.expiresInHours === 'number' && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 24 * 30)
        : 24 * 7; // Default 7 days
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

    const [created] = await db
      .insert(schema.workspaceInvitations)
      .values({
        id: uid('invt'),
        workspaceId: ctx.workspaceId,
        email: emailNorm,
        name: body.name?.trim() || null,
        role: body.role,
        tokenHash,
        invitedByUserId: ctx.userId,
        expiresAt,
      })
      .returning();

    const appOrigin = (helpers.getEnv('APP_ORIGIN') || 'http://localhost:5173').split(',')[0].trim();
    const invitePath = `/?invite=${encodeURIComponent(rawToken)}`;
    const inviteUrl = `${appOrigin}${invitePath}`;

    let emailDispatched = false;
    const resendKey = helpers.getEnv('RESEND_API_KEY');
    if (resendKey) {
      try {
        await sendViaResendEmail({
          apiKey: resendKey,
          fromEmail: helpers.getEnv('RESEND_FROM_EMAIL') || 'team@kraya.in',
          toEmail: emailNorm,
          subject: `You're invited to join ${ws?.legalName || 'Kraya'} (${body.role.toUpperCase()})`,
          bodyText: `Hello${body.name ? ` ${body.name}` : ''},\n\nYou have been invited as ${body.role.toUpperCase()} to ${ws?.legalName || 'a Kraya procurement workspace'}.\n\nAccept your invitation before ${expiresAt.toISOString()}:\n${inviteUrl}`,
        });
        emailDispatched = true;
      } catch {
        emailDispatched = false;
      }
    }

    await recordAuditLog(db, ctx, 'team_invitation_created', 'workspace_invitation', created.id, {
      email: emailNorm,
      role: body.role,
      expiresAt: expiresAt.toISOString(),
    });

    return c.json(
      {
        invitation: {
          id: created.id,
          email: created.email,
          name: created.name,
          role: created.role,
          expiresAt: created.expiresAt,
        },
        inviteToken: rawToken,
        invitePath,
        inviteUrl,
        emailDispatched,
      },
      201
    );
  });

  app.delete('/api/team/invitations/:id', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can revoke invitations.' }, 403);
    }
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [revoked] = await db
      .update(schema.workspaceInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceInvitations.id, id),
          eq(schema.workspaceInvitations.workspaceId, ctx.workspaceId),
          isNull(schema.workspaceInvitations.acceptedAt)
        )
      )
      .returning();

    if (!revoked) return c.json({ error: 'Pending invitation not found.' }, 404);
    await recordAuditLog(db, ctx, 'team_invitation_revoked', 'workspace_invitation', id);
    return c.json({ ok: true, id });
  });

  // Public preview of an invitation link
  app.get('/api/auth/invitations/:token', async (c) => {
    const rawToken = c.req.param('token');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const tokenHash = await sha256Hex(rawToken);

    const [inv] = await db
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.tokenHash, tokenHash))
      .limit(1);

    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt <= new Date()) {
      return c.json({ error: 'Invitation is invalid, revoked, already used, or expired.' }, 404);
    }

    const [[ws], [existingUser]] = await Promise.all([
      db.select({ legalName: schema.workspaces.legalName }).from(schema.workspaces).where(eq(schema.workspaces.id, inv.workspaceId)).limit(1),
      db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.email, inv.email)).limit(1),
    ]);

    return c.json({
      email: inv.email,
      name: inv.name || existingUser?.name || '',
      role: inv.role,
      workspaceName: ws?.legalName || 'Kraya Workspace',
      expiresAt: inv.expiresAt,
      existingAccount: Boolean(existingUser),
    });
  });

  // Public acceptance of an invitation (creates new user OR links existing user to second workspace)
  app.post('/api/auth/invitations/accept', async (c) => {
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      token: string;
      name?: string;
      password: string;
      dpdpConsentAccepted?: boolean;
    }>();

    if (!body.token?.trim() || !body.password) {
      return c.json({ error: 'Invitation token and password are required.' }, 400);
    }

    const tokenHash = await sha256Hex(body.token.trim());
    const [inv] = await db
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.tokenHash, tokenHash))
      .limit(1);

    if (!inv) return c.json({ error: 'Invitation not found.' }, 404);
    if (inv.revokedAt) return c.json({ error: 'This invitation has been revoked.' }, 410);
    if (inv.acceptedAt) return c.json({ error: 'This invitation has already been accepted.' }, 409);
    if (inv.expiresAt <= new Date()) return c.json({ error: 'This invitation has expired.' }, 410);

    let [usr] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, inv.email))
      .limit(1);

    if (usr) {
      // Existing account joining a new workspace — verify password
      const ok = await verifyPassword(body.password, usr.passwordHash);
      if (!ok) {
        return c.json({ error: 'Incorrect password for existing account.' }, 401);
      }
    } else {
      if (!body.dpdpConsentAccepted) {
        return c.json({ error: 'DPDP Act 2023 consent is required to create your account.' }, 400);
      }
      if (body.password.length < 8 || !(body.name || inv.name)?.trim()) {
        return c.json({ error: 'Full name and password (min 8 chars) are required.' }, 400);
      }
      const userId = uid('usr');
      const passwordHash = await hashPassword(body.password);
      const [createdUsr] = await db
        .insert(schema.users)
        .values({
          id: userId,
          workspaceId: inv.workspaceId,
          name: (body.name || inv.name || '').trim(),
          email: inv.email,
          passwordHash,
          role: inv.role,
        })
        .returning();
      usr = createdUsr;
    }

    // Add membership (idempotent if already present)
    const [existingMem] = await db
      .select()
      .from(schema.workspaceMemberships)
      .where(
        and(
          eq(schema.workspaceMemberships.workspaceId, inv.workspaceId),
          eq(schema.workspaceMemberships.userId, usr.id)
        )
      )
      .limit(1);

    if (!existingMem) {
      await db.insert(schema.workspaceMemberships).values({
        id: uid('mem'),
        workspaceId: inv.workspaceId,
        userId: usr.id,
        role: inv.role,
        invitedBy: inv.invitedByUserId,
      });
    }

    await db
      .update(schema.workspaceInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.workspaceInvitations.id, inv.id));

    const sessionToken = generateSecureToken(32);
    const ttlSeconds = helpers.getSessionTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db.insert(schema.sessions).values({
      token: sessionToken,
      userId: usr.id,
      workspaceId: inv.workspaceId,
      role: inv.role,
      expiresAt,
      lastSeenAt: new Date(),
    });

    await recordAuditLog(
      db,
      { workspaceId: inv.workspaceId, email: usr.email, role: inv.role as 'owner' | 'clerk' | 'ca' },
      'team_invitation_accepted',
      'workspace_invitation',
      inv.id,
      { role: inv.role }
    );

    const secureCookie = helpers.isProduction() || isHttpsRequest(c);
    c.header('Set-Cookie', buildSessionCookie(sessionToken, { maxAgeSeconds: ttlSeconds, secure: secureCookie }));

    return c.json(
      {
        token: sessionToken,
        user: {
          id: usr.id,
          name: usr.name,
          email: usr.email,
          role: inv.role,
          workspaceId: inv.workspaceId,
        },
      },
      201
    );
  });

  app.patch('/api/team/members/:userId/role', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can change team roles.' }, 403);
    }
    const targetUserId = c.req.param('userId');
    const body = await c.req.json<{ role?: string }>();
    if (!body.role || !VALID_ROLES.has(body.role)) {
      return c.json({ error: 'Role must be owner, clerk, or ca.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const allMembers = await db
      .select()
      .from(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.workspaceId, ctx.workspaceId));

    const target = allMembers.find((m) => m.userId === targetUserId);
    if (!target) return c.json({ error: 'Team member not found in this workspace.' }, 404);

    if (target.role === 'owner' && body.role !== 'owner') {
      const ownersCount = allMembers.filter((m) => m.role === 'owner').length;
      if (ownersCount <= 1) {
        return c.json({ error: 'Cannot demote the last remaining Owner of this workspace.' }, 400);
      }
    }

    await db
      .update(schema.workspaceMemberships)
      .set({ role: body.role })
      .where(eq(schema.workspaceMemberships.id, target.id));

    await db
      .update(schema.sessions)
      .set({ role: body.role })
      .where(
        and(
          eq(schema.sessions.userId, targetUserId),
          eq(schema.sessions.workspaceId, ctx.workspaceId)
        )
      );

    await recordAuditLog(db, ctx, 'team_role_updated', 'user', targetUserId, { newRole: body.role });
    return c.json({ ok: true, userId: targetUserId, role: body.role });
  });

  app.delete('/api/team/members/:userId', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can remove team members.' }, 403);
    }
    const targetUserId = c.req.param('userId');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const allMembers = await db
      .select()
      .from(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.workspaceId, ctx.workspaceId));

    const target = allMembers.find((m) => m.userId === targetUserId);
    if (!target) return c.json({ error: 'Team member not found in this workspace.' }, 404);

    if (target.role === 'owner') {
      const ownersCount = allMembers.filter((m) => m.role === 'owner').length;
      if (ownersCount <= 1) {
        return c.json({ error: 'Cannot remove the last remaining Owner of this workspace.' }, 400);
      }
    }

    await db.delete(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.id, target.id));
    await db
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, targetUserId),
          eq(schema.sessions.workspaceId, ctx.workspaceId)
        )
      );

    await recordAuditLog(db, ctx, 'team_member_removed', 'user', targetUserId);
    return c.json({ ok: true, userId: targetUserId });
  });

  // Backward-compatible direct member creation endpoint (Owner only)
  app.post('/api/auth/invite', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can invite Purchase Clerks or CAs.' }, 403);
    }
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{ name: string; email: string; tempPassword: string; role: 'clerk' | 'ca' | 'owner' }>();
    if (!body.email?.includes('@') || (body.tempPassword || '').length < 8 || !VALID_ROLES.has(body.role)) {
      return c.json({ error: 'Valid email, role, and temporary password (min 8 chars) required.' }, 400);
    }
    const emailNorm = body.email.trim().toLowerCase();
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, emailNorm)).limit(1);
    if (existing.length > 0) {
      return c.json({ error: 'User with this email already exists. Use token invitation to add to another workspace.' }, 409);
    }
    const passwordHash = await hashPassword(body.tempPassword);
    const userId = uid('usr');
    await db.insert(schema.users).values({
      id: userId,
      workspaceId: ctx.workspaceId,
      name: (body.name || emailNorm.split('@')[0]).trim(),
      email: emailNorm,
      passwordHash,
      role: body.role,
    });
    await db.insert(schema.workspaceMemberships).values({
      id: uid('mem'),
      workspaceId: ctx.workspaceId,
      userId,
      role: body.role,
      invitedBy: ctx.userId,
    });
    await recordAuditLog(db, ctx, 'team_member_added', 'user', userId, { role: body.role, email: emailNorm });
    return c.json({ id: userId, name: (body.name || emailNorm.split('@')[0]).trim(), email: emailNorm, role: body.role }, 201);
  });
}
