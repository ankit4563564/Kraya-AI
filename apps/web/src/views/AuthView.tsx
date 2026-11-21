import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck, AlertTriangle, CheckCircle2, KeyRound, UserPlus } from 'lucide-react';
import { apiJson, setStoredAuthToken } from '../lib/api';

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset' | 'invite';

interface InvitePreview {
  email: string;
  name: string;
  role: 'owner' | 'clerk' | 'ca';
  workspaceName: string;
  expiresAt: string;
  existingAccount: boolean;
}

interface Props {
  initialInviteToken?: string | null;
  initialResetToken?: string | null;
  onAuthenticated: () => void;
}

export function AuthView({ initialInviteToken, initialResetToken, onAuthenticated }: Props) {
  const [mode, setMode] = useState<AuthMode>(() => {
    if (initialInviteToken) return 'invite';
    if (initialResetToken) return 'reset';
    return 'login';
  });

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [dpdpConsent, setDpdpConsent] = useState(false);

  // Reset / Invite states
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [inviteToken] = useState(initialInviteToken || '');
  const [inviteInfo, setInviteInfo] = useState<InvitePreview | null>(null);
  const [devResetInfo, setDevResetInfo] = useState<{ token: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'invite' || !inviteToken) return;
    setError(null);
    apiJson<InvitePreview>(`/api/auth/invitations/${encodeURIComponent(inviteToken)}`)
      .then((info) => {
        setInviteInfo(info);
        setEmail(info.email);
        if (info.name) setFullName(info.name);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Invitation is invalid or expired.');
      });
  }, [mode, inviteToken]);

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setSubmitting(true);
    try {
      const res = await apiJson<{ token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.token) setStoredAuthToken(res.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!dpdpConsent) {
      setError('Please accept DPDP Act 2023 data processing consent to create your workspace.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiJson<{ token?: string }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: fullName,
          companyName,
          email,
          password,
          dpdpConsentAccepted: dpdpConsent,
        }),
      });
      if (res.token) setStoredAuthToken(res.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setDevResetInfo(null);
    setSubmitting(true);
    try {
      const res = await apiJson<{
        ok: boolean;
        message: string;
        devResetToken?: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice(res.message);
      if (res.devResetToken) {
        setDevResetInfo({ token: res.devResetToken });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request password reset.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setSubmitting(true);
    try {
      const res = await apiJson<{ ok: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword: password }),
      });
      setNotice(res.message);
      setPassword('');
      setMode('login');
      window.history.replaceState({}, '', '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!inviteInfo?.existingAccount && !dpdpConsent) {
      setError('Please accept DPDP Act 2023 consent to join this workspace.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiJson<{ token?: string }>('/api/auth/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token: inviteToken,
          name: fullName,
          password,
          dpdpConsentAccepted: inviteInfo?.existingAccount ? true : dpdpConsent,
        }),
      });
      if (res.token) setStoredAuthToken(res.token);
      window.history.replaceState({}, '', '/');
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
          <div className="brand-mark">K</div>
          <div className="brand-text">
            <strong>Kraya</strong>
            <span>AI Procurement CFO for Indian SMBs</span>
          </div>
        </div>

        {(mode === 'login' || mode === 'signup') && (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => {
                clearFeedback();
                setMode('login');
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => {
                clearFeedback();
                setMode('signup');
              }}
            >
              Create company account
            </button>
          </div>
        )}

        {error && (
          <div className="alert-banner alert-danger" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="alert-banner alert-success" role="status">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </div>
        )}

        {/* SIGN IN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} aria-labelledby="login-heading" method="post">
            <h1 id="login-heading" className="auth-title">
              Sign in to your workspace
            </h1>
            <p className="auth-subtitle">
              Protected by HTTP-only session cookies &amp; tenant-isolated PostgreSQL.
            </p>

            <div className="field">
              <label htmlFor="login-email">Work Email</label>
              <span id="login-email-hint" className="hint">
                Format: owner@company.in
              </span>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                enterKeyHint="next"
                aria-describedby="login-email-hint"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="error-msg">Enter a valid email address (e.g. you@company.in).</div>
            </div>

            <div className="field">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label htmlFor="login-password">Password</label>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    clearFeedback();
                    setMode('forgot');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="password-wrap">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="error-msg">Please enter your password (minimum 8 characters).</div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, minHeight: 44 }}
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}

        {/* SIGN UP FORM */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} aria-labelledby="signup-heading" method="post">
            <h1 id="signup-heading" className="auth-title">
              Create your company workspace
            </h1>
            <p className="auth-subtitle">
              Zero dummy data. Set up your GSTIN &amp; WACC right after creating your owner account.
            </p>

            <div className="field">
              <label htmlFor="signup-name">Your Full Name</label>
              <input
                id="signup-name"
                name="name"
                type="text"
                required
                autoComplete="name"
                enterKeyHint="next"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <div className="error-msg">Please enter your full name.</div>
            </div>

            <div className="field">
              <label htmlFor="signup-company">Company Legal Name</label>
              <span id="signup-company-hint" className="hint">
                You can verify your GSTIN and business address in the next step.
              </span>
              <input
                id="signup-company"
                name="organization"
                type="text"
                required
                autoComplete="organization"
                enterKeyHint="next"
                aria-describedby="signup-company-hint"
                placeholder="e.g. Bangalore Packaging Works Pvt Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
              <div className="error-msg">Please enter your company legal name.</div>
            </div>

            <div className="field">
              <label htmlFor="signup-email">Work Email</label>
              <input
                id="signup-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="error-msg">Enter a valid work email address.</div>
            </div>

            <div className="field">
              <label htmlFor="signup-password">New Password</label>
              <span id="signup-pw-hint" className="hint">
                At least 8 characters. Password managers &amp; pasting are supported.
              </span>
              <div className="password-wrap">
                <input
                  id="signup-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  aria-describedby="signup-pw-hint"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="error-msg">Password must be at least 8 characters long.</div>
            </div>

            <label className="checkbox-row" htmlFor="dpdp-consent">
              <input
                id="dpdp-consent"
                type="checkbox"
                checked={dpdpConsent}
                onChange={(e) => setDpdpConsent(e.target.checked)}
                required
              />
              <span>
                I consent to processing my company&apos;s procurement documents under India&apos;s{' '}
                <strong>DPDP Act 2023</strong> (with 1-click data export &amp; right to erasure).
              </span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 12, minHeight: 44 }}
              disabled={submitting}
            >
              {submitting ? 'Creating workspace...' : 'Create account'}
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD FORM */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot} aria-labelledby="forgot-heading" method="post">
            <h1 id="forgot-heading" className="auth-title">
              <KeyRound size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Reset your password
            </h1>
            <p className="auth-subtitle">
              Enter your registered work email to receive a 30-minute reset link.
            </p>

            <div className="field">
              <label htmlFor="forgot-email">Work Email</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                enterKeyHint="done"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
              disabled={submitting}
            >
              {submitting ? 'Sending instructions...' : 'Send reset instructions'}
            </button>

            {devResetInfo && (
              <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--bg-subtle)', fontSize: 12 }}>
                <strong>Local Dev Notice (Resend email not configured):</strong>
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setResetToken(devResetInfo.token);
                      setMode('reset');
                      clearFeedback();
                    }}
                  >
                    Open password reset form with local token
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  clearFeedback();
                  setMode('login');
                }}
              >
                Back to Sign in
              </button>
            </div>
          </form>
        )}

        {/* RESET PASSWORD FORM */}
        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} aria-labelledby="reset-heading" method="post">
            <h1 id="reset-heading" className="auth-title">
              Set a new password
            </h1>
            <p className="auth-subtitle">
              All previous active sessions will be signed out for security.
            </p>

            <div className="field">
              <label htmlFor="reset-token">Reset Token</label>
              <input
                id="reset-token"
                name="token"
                type="text"
                required
                spellCheck={false}
                className="mono"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="reset-password">New Password</label>
              <span className="hint">Minimum 8 characters.</span>
              <div className="password-wrap">
                <input
                  id="reset-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
              disabled={submitting}
            >
              {submitting ? 'Updating password...' : 'Update password'}
            </button>
          </form>
        )}

        {/* ACCEPT TEAM INVITATION FORM */}
        {mode === 'invite' && (
          <form onSubmit={handleAcceptInvite} aria-labelledby="invite-heading" method="post">
            <h1 id="invite-heading" className="auth-title">
              <UserPlus size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Join {inviteInfo?.workspaceName || 'Workspace'}
            </h1>
            {inviteInfo ? (
              <>
                <p className="auth-subtitle">
                  You have been invited as{' '}
                  <strong className="mono">{inviteInfo.role.toUpperCase()}</strong> ({inviteInfo.email}).
                </p>

                {!inviteInfo.existingAccount && (
                  <div className="field">
                    <label htmlFor="inv-name">Your Full Name</label>
                    <input
                      id="inv-name"
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="inv-password">
                    {inviteInfo.existingAccount ? 'Your Existing Account Password' : 'Create Password'}
                  </label>
                  <span className="hint">Minimum 8 characters.</span>
                  <div className="password-wrap">
                    <input
                      id="inv-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete={inviteInfo.existingAccount ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-pressed={showPassword}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {!inviteInfo.existingAccount && (
                  <label className="checkbox-row" htmlFor="inv-dpdp">
                    <input
                      id="inv-dpdp"
                      type="checkbox"
                      checked={dpdpConsent}
                      onChange={(e) => setDpdpConsent(e.target.checked)}
                      required
                    />
                    <span>I accept DPDP Act 2023 processing terms for this workspace.</span>
                  </label>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12, minHeight: 44 }}
                  disabled={submitting}
                >
                  {submitting ? 'Joining workspace...' : 'Accept invitation'}
                </button>
              </>
            ) : (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    window.history.replaceState({}, '', '/');
                    setMode('login');
                    clearFeedback();
                  }}
                >
                  Go to Sign in
                </button>
              </div>
            )}
          </form>
        )}

        <div className="auth-footer">
          <ShieldCheck size={14} />
          <span>Deterministic GST 2.0 + Section 43B(h) Finance Engine · Multi-Tenant Isolated</span>
        </div>
      </div>
    </div>
  );
}
