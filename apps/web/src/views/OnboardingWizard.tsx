import React, { useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, Building2, LogOut } from 'lucide-react';
import { apiJson, INDIAN_STATES, OutreachLang, WorkspaceProfile } from '../lib/api';

interface Props {
  workspace: WorkspaceProfile;
  userEmail: string;
  userName: string;
  onCompleted: (updated: WorkspaceProfile) => void;
  onLogout: () => void;
}

export function OnboardingWizard({ workspace, userEmail, userName, onCompleted, onLogout }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // 8 Mandatory Company Onboarding Fields (never fabricated)
  const [legalName, setLegalName] = useState(workspace.legalName || '');
  const [gstRegime, setGstRegime] = useState<WorkspaceProfile['gstRegime']>(workspace.gstRegime || 'regular');
  const [gstin, setGstin] = useState(workspace.gstin || '');
  const [stateCode, setStateCode] = useState(workspace.stateCode || '29');
  const [turnoverBand, setTurnoverBand] = useState<WorkspaceProfile['turnoverBand']>(
    workspace.turnoverBand || 'under_5cr'
  );
  const [waccPct, setWaccPct] = useState(String(workspace.waccPct ?? 15));
  const [defaultOutreachLang, setDefaultOutreachLang] = useState<OutreachLang>(
    workspace.defaultOutreachLang || 'english'
  );
  const [businessAddress, setBusinessAddress] = useState(workspace.businessAddress || '');
  const [primaryContactName, setPrimaryContactName] = useState(workspace.primaryContactName || userName || '');
  const [primaryContactPhone, setPrimaryContactPhone] = useState(workspace.primaryContactPhone || '');
  const [primaryContactEmail, setPrimaryContactEmail] = useState(workspace.primaryContactEmail || userEmail || '');

  const [gstinInfo, setGstinInfo] = useState<{ valid: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGstinChange = async (val: string) => {
    const clean = val.trim().toUpperCase();
    setGstin(clean);
    if (!clean) {
      setGstinInfo(null);
      return;
    }
    if (clean.length === 15) {
      try {
        const res = await apiJson<{
          valid: boolean;
          stateCode: string | null;
          stateName: string | null;
          panEntityLabel: string | null;
          errors: string[];
        }>('/api/gstin/validate', {
          method: 'POST',
          body: JSON.stringify({ gstin: clean }),
        });
        if (res.valid) {
          if (res.stateCode) setStateCode(res.stateCode);
          setGstinInfo({
            valid: true,
            msg: `Verified Mod-36 Checksum · ${res.stateName} (${res.stateCode}) · ${res.panEntityLabel}. Please verify & edit state below if needed.`,
          });
        } else {
          setGstinInfo({ valid: false, msg: res.errors[0] || 'Invalid GSTIN checksum' });
        }
      } catch {
        setGstinInfo(null);
      }
    } else {
      setGstinInfo({ valid: false, msg: `${clean.length}/15 characters entered` });
    }
  };

  const goToStep = (next: 1 | 2) => {
    setError(null);
    if (next === 2) {
      if (!legalName.trim()) {
        setError('Please enter your Company Legal Name.');
        return;
      }
      if (gstRegime !== 'unregistered' && gstin.trim() && gstinInfo && !gstinInfo.valid) {
        setError('Please fix the invalid GSTIN or clear it if pending registration.');
        return;
      }
    }
    setStep(next);
    setTimeout(() => stepHeadingRef.current?.focus(), 0);
  };

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiJson<WorkspaceProfile>('/api/workspace/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          legalName: legalName.trim(),
          gstin: gstRegime === 'unregistered' ? null : gstin.trim() || null,
          gstRegime,
          stateCode,
          turnoverBand,
          waccPct: Number(waccPct),
          defaultOutreachLang,
          businessAddress: businessAddress.trim(),
          primaryContactName: primaryContactName.trim(),
          primaryContactPhone: primaryContactPhone.trim(),
          primaryContactEmail: primaryContactEmail.trim(),
        }),
      });
      onCompleted(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card onboarding-card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="brand-mark">
              <Building2 size={16} />
            </div>
            <div className="brand-text">
              <strong>Company Setup</strong>
              <span>Configure your Indian GST &amp; working-capital baseline</span>
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onLogout}>
            <LogOut size={13} /> Sign out
          </button>
        </div>

        <nav aria-label="Onboarding progress">
          <ol className="progress-tracker">
            <li className={step === 1 ? 'step-active' : 'step-done'} aria-current={step === 1 ? 'step' : undefined}>
              1. Company &amp; GSTIN
            </li>
            <li className={step === 2 ? 'step-active' : 'step-todo'} aria-current={step === 2 ? 'step' : undefined}>
              2. WACC, Turnover &amp; Contact
            </li>
          </ol>
        </nav>

        {error && (
          <div className="alert-banner alert-danger" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleFinish} method="post">
          {step === 1 && (
            <div>
              <h1 ref={stepHeadingRef} tabIndex={-1} className="auth-title">
                Step 1: Company Legal &amp; GST Identity
              </h1>
              <p className="auth-subtitle">
                Enter your actual GST details so CGST/SGST vs. IGST and ITC eligibility are 100% accurate. We never invent missing company details.
              </p>

              <div className="field">
                <label htmlFor="ob-legal-name">Company Legal Name *</label>
                <span className="hint">Appears on GST Purchase Orders and supplier emails.</span>
                <input
                  id="ob-legal-name"
                  name="legalName"
                  required
                  autoComplete="organization"
                  enterKeyHint="next"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                />
              </div>

              <fieldset className="radio-fieldset">
                <legend>GST Registration Type *</legend>
                <div className="radio-grid">
                  {[
                    { val: 'regular', label: 'Regular', desc: 'Full GST Input Tax Credit (ITC)' },
                    { val: 'composition', label: 'Composition', desc: 'No ITC — GST added to landed cost' },
                    { val: 'unregistered', label: 'Unregistered', desc: 'Below threshold / no GSTIN' },
                  ].map((opt) => (
                    <label
                      key={opt.val}
                      className={`radio-card ${gstRegime === opt.val ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="gstRegime"
                        value={opt.val}
                        checked={gstRegime === opt.val}
                        onChange={() => setGstRegime(opt.val as WorkspaceProfile['gstRegime'])}
                      />
                      <div>
                        <strong>{opt.label}</strong>
                        <div className="hint" style={{ margin: 0 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              {gstRegime !== 'unregistered' && (
                <div className="field">
                  <label htmlFor="ob-gstin">Company GSTIN (15 characters)</label>
                  <span className="hint">
                    Auto-parses State Code &amp; PAN entity offline using official Mod-36 checksum. Leave blank only if registration is pending.
                  </span>
                  <input
                    id="ob-gstin"
                    name="gstin"
                    maxLength={15}
                    className="mono"
                    spellCheck={false}
                    placeholder="29AABCB1234F1Z..."
                    value={gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                  />
                  {gstinInfo && (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        color: gstinInfo.valid ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      {gstinInfo.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      <span>{gstinInfo.msg}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="field">
                <label htmlFor="ob-state">State &amp; GST State Code *</label>
                <span className="hint">Used to enforce Intra-State (CGST+SGST) vs. Inter-State (IGST) tax rules.</span>
                <select
                  id="ob-state"
                  name="stateCode"
                  required
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                >
                  {INDIAN_STATES.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.code} — {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => goToStep(2)}
                >
                  Next: WACC &amp; Contact <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 ref={stepHeadingRef} tabIndex={-1} className="auth-title">
                Step 2: Financial Parameters &amp; Primary Contact
              </h1>
              <p className="auth-subtitle">
                Your WACC powers Credit-Adjusted Landed Cost rankings; Turnover Band activates TDS 194Q advisories above ₹10 Cr.
              </p>

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="ob-turnover">Business Turnover Category *</label>
                  <select
                    id="ob-turnover"
                    name="turnoverBand"
                    value={turnoverBand}
                    onChange={(e) => setTurnoverBand(e.target.value as WorkspaceProfile['turnoverBand'])}
                  >
                    <option value="under_5cr">Under ₹5 Cr</option>
                    <option value="5cr_to_10cr">₹5 Cr – ₹10 Cr</option>
                    <option value="above_10cr">Above ₹10 Cr (TDS 194Q applicable)</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="ob-wacc">Default WACC (% p.a.) *</label>
                  <span className="hint">Typical Indian SMB CC/OD rate: 12–18%</span>
                  <input
                    id="ob-wacc"
                    name="waccPct"
                    type="number"
                    min="0"
                    max="48"
                    step="0.5"
                    required
                    value={waccPct}
                    onChange={(e) => setWaccPct(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="ob-lang">Default Supplier Outreach Language</label>
                <select
                  id="ob-lang"
                  name="defaultOutreachLang"
                  value={defaultOutreachLang}
                  onChange={(e) => setDefaultOutreachLang(e.target.value as OutreachLang)}
                >
                  <option value="english">Business English</option>
                  <option value="hinglish">Polite Hinglish</option>
                  <option value="hindi">हिन्दी (Hindi)</option>
                  <option value="kannada">ಕನ್ನಡ (Kannada)</option>
                  <option value="tamil">தமிழ் (Tamil)</option>
                  <option value="malayalam">മലയാളം (Malayalam)</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="ob-address">Registered / Factory Business Address *</label>
                <span className="hint">Printed as Bill-To / Ship-To address on generated GST Purchase Orders.</span>
                <textarea
                  id="ob-address"
                  name="businessAddress"
                  rows={2}
                  required
                  autoComplete="street-address"
                  placeholder="Plot 42, Peenya Industrial Area, Phase 2, Bengaluru, Karnataka 560058"
                  value={businessAddress}
                  onChange={(e) => setBusinessAddress(e.target.value)}
                />
              </div>

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="ob-contact-name">Primary Contact Name *</label>
                  <input
                    id="ob-contact-name"
                    name="primaryContactName"
                    required
                    autoComplete="name"
                    value={primaryContactName}
                    onChange={(e) => setPrimaryContactName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ob-contact-phone">Primary Contact Phone *</label>
                  <input
                    id="ob-contact-phone"
                    name="primaryContactPhone"
                    type="tel"
                    required
                    autoComplete="tel"
                    placeholder="+91 98450 12345"
                    value={primaryContactPhone}
                    onChange={(e) => setPrimaryContactPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="ob-contact-email">Primary Contact Email *</label>
                <input
                  id="ob-contact-email"
                  name="primaryContactEmail"
                  type="email"
                  required
                  spellCheck={false}
                  autoComplete="email"
                  value={primaryContactEmail}
                  onChange={(e) => setPrimaryContactEmail(e.target.value)}
                />
              </div>

              <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => goToStep(1)}
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving workspace...' : 'Complete Company Setup'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
