import React, { useId, useState } from 'react';
import { Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2, Building2, User, Mail, Lock, FileText, ArrowRight } from 'lucide-react';
import { apiJson, INDIAN_STATES, setStoredAuthToken } from '../lib/api';
import { validateGstin } from '../lib/gstin';
import { ModalDialog } from './ModalDialog';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
  allowDevWorkspaceContinue?: boolean;
}

type AuthTab = 'signin' | 'signup';

export function AuthModal({
  open,
  onClose,
  onAuthenticated,
  allowDevWorkspaceContinue = true,
}: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Sign In state
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  // Sign Up / Company Onboarding state
  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('29'); // Default Karnataka (29) or auto-filled from GSTIN
  const [userName, setUserName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [dpdpConsent, setDpdpConsent] = useState(false);

  // Live offline Mod-36 GSTIN validation
  const gstinResult = gstin.trim() ? validateGstin(gstin.trim()) : null;

  const handleGstinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
    setGstin(raw);
    if (raw.length >= 2) {
      const code = raw.slice(0, 2);
      if (INDIAN_STATES.some((s) => s.code === code)) {
        setStateCode(code);
      }
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await apiJson<{
        token: string;
        user: { id: string; name: string; email: string; role: string; workspaceId: string };
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: signInEmail, password: signInPassword }),
      });

      if (res.token) {
        setStoredAuthToken(res.token);
      }
      onAuthenticated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!dpdpConsent) {
      setError('You must accept the DPDP Act 2023 data processing consent to proceed.');
      return;
    }

    if (gstin.trim()) {
      const check = validateGstin(gstin.trim());
      if (!check.valid) {
        setError(`Invalid GSTIN: ${check.errors.join('; ')}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await apiJson<{
        token: string;
        user: { id: string; name: string; email: string; role: string; workspaceId: string };
      }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          companyName: companyName.trim(),
          gstin: gstin.trim() ? gstin.trim().toUpperCase() : undefined,
          stateCode,
          name: userName.trim(),
          email: signUpEmail.trim().toLowerCase(),
          password: signUpPassword,
          dpdpConsentAccepted: dpdpConsent,
        }),
      });

      if (res.token) {
        setStoredAuthToken(res.token);
      }
      onAuthenticated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register company workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={tab === 'signin' ? 'Sign in to Kraya' : 'Company Onboarding & Sign Up'}
      footer={
        allowDevWorkspaceContinue ? (
          <div className="row" style={{ justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClose}
              style={{ color: 'var(--text-secondary)' }}
            >
              Continue with Local Dev Workspace
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              DPDP Act 2023 · ISO 27001 Ready
            </div>
          </div>
        ) : undefined
      }
    >
      <div style={{ padding: '4px 0' }}>
        {/* Tab switchers */}
        <div className="auth-tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`auth-tab ${tab === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setTab('signin');
              setError(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setTab('signup');
              setError(null);
            }}
          >
            Sign Up / Company Onboarding
          </button>
        </div>

        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 14 }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="alert alert-success" style={{ marginBottom: 14 }}>
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}

        {tab === 'signin' ? (
          <form onSubmit={handleSignIn} className="field-group" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="signin-email">
                <Mail size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Email Address
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@company.in"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <label htmlFor="signin-password">
                <Lock size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ marginTop: 8 }}
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="field-group" style={{ gap: 12 }}>
            <div className="field">
              <label htmlFor="signup-company">
                <Building2 size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Company Legal Name *
              </label>
              <input
                id="signup-company"
                type="text"
                required
                placeholder="e.g. Acme Manufacturing Pvt Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1.2 }}>
                <label htmlFor="signup-gstin">
                  GSTIN (15-char Mod-36)
                </label>
                <input
                  id="signup-gstin"
                  type="text"
                  placeholder="29ABCDE1234F1Z5"
                  value={gstin}
                  onChange={handleGstinChange}
                  className="mono"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="signup-state">Place of Supply State *</label>
                <select
                  id="signup-state"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  required
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {gstinResult && gstin.trim().length > 0 && (
              <div
                style={{
                  fontSize: 11.5,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: gstinResult.valid ? 'var(--success-soft)' : 'var(--warning-soft)',
                  color: gstinResult.valid ? 'var(--success)' : 'var(--warning)',
                  marginTop: -4,
                }}
              >
                {gstinResult.valid ? (
                  <span>
                    ✓ Valid Mod-36 Checksum · {gstinResult.stateName} · {gstinResult.panEntityLabel || 'Verified'}
                  </span>
                ) : (
                  <span>⚠ {gstinResult.errors[0] || 'Incomplete GSTIN'}</span>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="signup-username">
                <User size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Owner / Authorized Person Name *
              </label>
              <input
                id="signup-username"
                type="text"
                required
                placeholder="e.g. Rajesh Kumar"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="signup-email">
                <Mail size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Official Work Email *
              </label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                placeholder="rajesh@acme.in"
                value={signUpEmail}
                onChange={(e) => setSignUpEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="signup-password">
                <Lock size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
                Password (min 8 characters) *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-subtle)',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
                marginTop: 2,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 11.5,
                  lineHeight: 1.4,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  required
                  checked={dpdpConsent}
                  onChange={(e) => setDpdpConsent(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>Mandatory DPDP Act 2023 Consent:</strong> I agree to the processing of business procurement, invoice, and contact records under the Digital Personal Data Protection Act, 2023 for automated quotation comparison, GST reconciliation, and statutory audit logging.
                </span>
              </label>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !dpdpConsent}
              style={{ marginTop: 6 }}
            >
              {submitting ? 'Creating Company Workspace...' : 'Create Company Workspace & Account'}
            </button>
          </form>
        )}
      </div>
    </ModalDialog>
  );
}
