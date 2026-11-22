import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import * as agentCore from '@kraya/agent-core';

describe('Google Gmail OAuth 2.0 Integration & Callback Routes', () => {
  it('GET /api/integrations/gmail/auth returns 400 when GMAIL_CLIENT_ID is not configured', async () => {
    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      GMAIL_CLIENT_ID: '',
    });

    const res = await app.request('/api/integrations/gmail/auth?format=json');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('GMAIL_CLIENT_ID');
  });

  it('GET /api/integrations/gmail/auth generates valid Google consent URL with exact redirectUri', async () => {
    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      GMAIL_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'test-secret',
    });

    const res = await app.request('/api/integrations/gmail/auth?format=json', {
      headers: { host: 'localhost:8787' },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; authUrl: string; redirectUri: string; scopes: string[] };
    expect(body.ok).toBe(true);
    expect(body.redirectUri).toBe('http://localhost:8787/api/integrations/gmail/callback');
    expect(body.authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(body.authUrl).toContain('client_id=test-client-id.apps.googleusercontent.com');
    expect(body.authUrl).toContain(encodeURIComponent('http://localhost:8787/api/integrations/gmail/callback'));
    expect(body.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
  });

  it('GET /api/integrations/gmail/callback returns 400 when code is missing', async () => {
    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
    });

    const res = await app.request('/api/integrations/gmail/callback?format=json');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('code');
  });

  it('GET /api/integrations/gmail/callback handles Google error parameters gracefully', async () => {
    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
    });

    const res = await app.request(
      '/api/integrations/gmail/callback?error=access_denied&error_description=User%20denied%20access&format=json'
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Google OAuth rejected');
    expect(body.error).toContain('User denied access');
  });

  it('GET /api/integrations/gmail/callback requires GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET', async () => {
    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
    });

    const res = await app.request('/api/integrations/gmail/callback?code=mock_code_123&format=json');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be configured');
  });

  it('GET /api/integrations/gmail/callback successfully exchanges authorization code and marks service CONNECTED', async () => {
    // Mock exchangeGoogleOAuthCode and getGmailUserProfile
    const exchangeSpy = vi.spyOn(agentCore, 'exchangeGoogleOAuthCode').mockResolvedValueOnce({
      accessToken: 'mock_access_token_xyz',
      refreshToken: 'mock_refresh_token_abc',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    });

    const profileSpy = vi.spyOn(agentCore, 'getGmailUserProfile').mockResolvedValueOnce({
      emailAddress: 'procurement@kraya-test.in',
      messagesTotal: 42,
      threadsTotal: 18,
      historyId: '998877',
    });

    const app = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      GMAIL_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'test-secret-456',
    });

    const res = await app.request('/api/integrations/gmail/callback?code=valid_auth_code&format=json', {
      headers: { host: 'localhost:8787' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      message: string;
      emailAddress: string;
      messagesTotal: number;
      hasRefreshToken: boolean;
    };

    expect(body.ok).toBe(true);
    expect(body.emailAddress).toBe('procurement@kraya-test.in');
    expect(body.hasRefreshToken).toBe(true);

    expect(exchangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'valid_auth_code',
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-secret-456',
        redirectUri: 'http://localhost:8787/api/integrations/gmail/callback',
      })
    );

    // Verify GET /api/integrations now reflects CONNECTED status for gmail
    const intRes = await app.request('/api/integrations');
    expect(intRes.status).toBe(200);
    const intData = (await intRes.json()) as { integrations: Array<{ id: string; status: string }> };
    const gmailCard = intData.integrations.find((i) => i.id === 'gmail');
    expect(gmailCard?.status).toBe('CONNECTED');

    exchangeSpy.mockRestore();
    profileSpy.mockRestore();
  });
});
