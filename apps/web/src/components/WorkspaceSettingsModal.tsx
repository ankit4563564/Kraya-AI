import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Monitor,
  Sun,
  Moon,
  Download,
  Trash2,
  Users,
  HardDrive,
  Building2,
  Copy,
  UserPlus,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import {
  API_BASE,
  apiJson,
  applyThemePref,
  formatBytes,
  getStoredThemePref,
  HealthInfo,
  INDIAN_STATES,
  StoredFileRecord,
  TeamInvitation,
  TeamMember,
  ThemePref,
  UserRole,
  WorkspaceProfile,
} from '../lib/api';
import { ModalDialog } from './ModalDialog';
import { VoiceCloneCard } from './VoiceCloneCard';

interface Props {
  open: boolean;
  workspace: WorkspaceProfile | null;
  userRole: UserRole;
  health: HealthInfo | null;
  onClose: () => void;
  onSaved: (updated: WorkspaceProfile) => void;
  onDataMutated: () => void;
}

type SettingsTab = 'company' | 'team' | 'vault' | 'audit';

interface AuditLogEntry {
  id: string;
  seqNum: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entryHash: string | null;
  createdAt: string;
}

interface AuditChainReport {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  latestHash: string | null;
  brokenEntryId: string | null;
  reason: string | null;
}

export function WorkspaceSettingsModal({
  open,
  workspace,
  userRole,
  health,
  onClose,
  onSaved,
  onDataMutated,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>('company');
  const isOwner = userRole === 'owner';
  const isCa = userRole === 'ca';

  // Company & GST fields
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('29');
  const [gstRegime, setGstRegime] = useState<'regular' | 'composition' | 'unregistered'>('regular');
  const [waccPct, setWaccPct] = useState('15');
  const [turnoverBand, setTurnoverBand] = useState<'under_5cr' | '5cr_to_10cr' | 'above_10cr'>('under_5cr');
  const [defaultOutreachLang, setDefaultOutreachLang] = useState<WorkspaceProfile['defaultOutreachLang']>('english');
  const [businessAddress, setBusinessAddress] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactPhone, setPrimaryContactPhone] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [policyPatchMd, setPolicyPatchMd] = useState('');
  const [themePref, setThemePref] = useState<ThemePref>(() => getStoredThemePref());

  const [gstinStatus, setGstinStatus] = useState<{ valid: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Team Management state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState<UserRole>('clerk');
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Persistent Vault Files & Audit Trail state
  const [files, setFiles] = useState<StoredFileRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [chainReport, setChainReport] = useState<AuditChainReport | null>(null);
  const [teamMsg, setTeamMsg] = useState<string | null>(null);

  const loadTeamAndVault = useCallback(() => {
    apiJson<TeamMember[]>('/api/team/members')
      .then(setMembers)
      .catch(() => {});
    if (isOwner) {
      apiJson<TeamInvitation[]>('/api/team/invitations')
        .then(setInvitations)
        .catch(() => {});
    }
    apiJson<StoredFileRecord[]>('/api/files')
      .then(setFiles)
      .catch(() => {});
    apiJson<AuditLogEntry[]>('/api/compliance/audit-logs')
      .then(setAuditLogs)
      .catch(() => {});
    apiJson<AuditChainReport>('/api/compliance/audit-logs/verify')
      .then(setChainReport)
      .catch(() => {});
  }, [isOwner]);

  useEffect(() => {
    if (!workspace || !open) return;
    setLegalName(workspace.legalName);
    setGstin(workspace.gstin || '');
    setStateCode(workspace.stateCode);
    setGstRegime(workspace.gstRegime);
    setWaccPct(String(workspace.waccPct));
    setTurnoverBand(workspace.turnoverBand);
    setDefaultOutreachLang(workspace.defaultOutreachLang);
    setBusinessAddress(workspace.businessAddress || '');
    setPrimaryContactName(workspace.primaryContactName || '');
    setPrimaryContactPhone(workspace.primaryContactPhone || '');
    setPrimaryContactEmail(workspace.primaryContactEmail || '');
    setPolicyPatchMd(workspace.policyPatchMd || '');
    setThemePref(getStoredThemePref());
    setGstinStatus(null);
    setError(null);
    setTeamMsg(null);
    setLastInviteLink(null);
    loadTeamAndVault();
  }, [workspace, open, loadTeamAndVault]);

  const handleVerifyGstin = async (val: string) => {
    const clean = val.trim().toUpperCase();
    setGstin(clean);
    if (clean.length === 0) {
      setGstinStatus(null);
      return;
    }
    if (clean.length === 15) {
      const check = await apiJson<{
        valid: boolean;
        stateCode: string | null;
        stateName: string | null;
        panEntityLabel: string | null;
        errors: string[];
      }>('/api/gstin/validate', {
        method: 'POST',
        body: JSON.stringify({ gstin: clean }),
      });
      if (check.valid) {
        if (check.stateCode) setStateCode(check.stateCode);
        setGstinStatus({
          valid: true,
          msg: `Valid Mod-36 Checksum · ${check.stateName} (${check.stateCode}) · ${check.panEntityLabel}`,
        });
      } else {
        setGstinStatus({ valid: false, msg: check.errors[0] || 'Invalid GSTIN' });
      }
    } else {
      setGstinStatus({ valid: false, msg: `${clean.length}/15 characters` });
    }
  };

  const handleThemeSelect = (next: ThemePref) => {
    setThemePref(next);
    applyThemePref(next);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiJson<WorkspaceProfile>('/api/workspace', {
        method: 'PUT',
        body: JSON.stringify({
          legalName,
          gstin: gstin || null,
          stateCode,
          gstRegime,
          waccPct: Number(waccPct) || 15,
          turnoverBand,
          defaultOutreachLang,
          businessAddress: businessAddress || null,
          primaryContactName: primaryContactName || null,
          primaryContactPhone: primaryContactPhone || null,
          primaryContactEmail: primaryContactEmail || null,
          policyPatchMd: policyPatchMd || null,
        }),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError(null);
    setTeamMsg(null);
    setInviting(true);
    try {
      const res = await apiJson<{
        invitePath: string;
        inviteUrl: string;
        emailDispatched: boolean;
      }>('/api/team/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: invEmail,
          name: invName || undefined,
          role: invRole,
        }),
      });
      const fullLink = `${window.location.origin}${res.invitePath}`;
      setLastInviteLink(fullLink);
      setCopiedLink(false);
      setInvEmail('');
      setInvName('');
      formEl.reset();
      setTeamMsg(
        res.emailDispatched
          ? 'Invitation email dispatched via Resend. You can also share the link below.'
          : 'Invitation created (expires in 7 days). Copy and share the invite link below with your team member.'
      );
      loadTeamAndVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    setError(null);
    try {
      await apiJson(`/api/team/invitations/${id}`, { method: 'DELETE' });
      loadTeamAndVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke invitation');
    }
  };

  const handleChangeRole = async (userId: string, role: UserRole) => {
    setError(null);
    try {
      await apiJson(`/api/team/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      loadTeamAndVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change role');
    }
  };

  const handleDeleteFile = async (id: string) => {
    setError(null);
    try {
      await apiJson(`/api/files/${id}`, { method: 'DELETE' });
      loadTeamAndVault();
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Workspace Settings, Team & File Vault"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {tab === 'company' && isOwner && (
            <button
              type="submit"
              form="workspace-settings-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Workspace Settings'}
            </button>
          )}
        </>
      }
    >
      <div className="settings-tabs" role="tablist" aria-label="Workspace settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'company'}
          className={`btn btn-sm ${tab === 'company' ? 'btn-primary' : ''}`}
          onClick={() => {
            setError(null);
            setTab('company');
          }}
        >
          <Building2 size={13} /> Company &amp; GST
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'team'}
          className={`btn btn-sm ${tab === 'team' ? 'btn-primary' : ''}`}
          onClick={() => {
            setError(null);
            setTab('team');
          }}
        >
          <Users size={13} /> Team &amp; Roles ({members.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'vault'}
          className={`btn btn-sm ${tab === 'vault' ? 'btn-primary' : ''}`}
          onClick={() => {
            setError(null);
            setTab('vault');
          }}
        >
          <HardDrive size={13} /> File Vault &amp; Status ({files.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          className={`btn btn-sm ${tab === 'audit' ? 'btn-primary' : ''}`}
          onClick={() => {
            setError(null);
            setTab('audit');
            loadTeamAndVault();
          }}
        >
          <ShieldCheck size={13} /> Audit Trail ({auditLogs.length})
        </button>
      </div>

      {error && (
        <div className="alert-banner alert-danger" role="alert" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: COMPANY & GST */}
      {tab === 'company' && (
        <form id="workspace-settings-form" onSubmit={handleSave}>
          {!isOwner && (
            <div className="alert-banner" style={{ marginBottom: 12, background: 'var(--bg-subtle)' }}>
              <span>
                You are signed in as <strong className="mono">{userRole.toUpperCase()}</strong>. Only Workspace Owners can modify GST/WACC settings.
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="ws-name">Company Legal Name</label>
            <span className="hint" id="ws-name-hint">
              Printed on GST Purchase Orders &amp; WhatsApp/Email outreach
            </span>
            <input
              id="ws-name"
              required
              disabled={!isOwner}
              aria-describedby="ws-name-hint"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="ws-gstin">Your GSTIN (Offline Mod-36 Verified)</label>
              <span className="hint" id="ws-gstin-hint">
                15-char GSTIN auto-sets State Code for CGST/IGST
              </span>
              <input
                id="ws-gstin"
                maxLength={15}
                disabled={!isOwner}
                placeholder="29AABCB1234F1Z..."
                className="mono"
                aria-describedby="ws-gstin-hint"
                value={gstin}
                onChange={(e) => handleVerifyGstin(e.target.value)}
              />
              {gstinStatus && (
                <div
                  style={{
                    fontSize: 11.5,
                    marginTop: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: gstinStatus.valid ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {gstinStatus.valid ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {gstinStatus.msg}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="ws-state">Place of Supply State</label>
              <select
                id="ws-state"
                disabled={!isOwner}
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
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="ws-regime">Buyer GST Regime</label>
              <select
                id="ws-regime"
                disabled={!isOwner}
                value={gstRegime}
                onChange={(e) => setGstRegime(e.target.value as WorkspaceProfile['gstRegime'])}
              >
                <option value="regular">Regular (ITC Claimable)</option>
                <option value="composition">Composition (No ITC)</option>
                <option value="unregistered">Unregistered (No ITC)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ws-wacc">Working Capital WACC (%)</label>
              <input
                id="ws-wacc"
                type="number"
                step="0.5"
                min="0"
                max="48"
                required
                disabled={!isOwner}
                value={waccPct}
                onChange={(e) => setWaccPct(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="ws-turnover">Annual Turnover Band</label>
              <select
                id="ws-turnover"
                disabled={!isOwner}
                value={turnoverBand}
                onChange={(e) => setTurnoverBand(e.target.value as WorkspaceProfile['turnoverBand'])}
              >
                <option value="under_5cr">Under ₹5 Cr</option>
                <option value="5cr_to_10cr">₹5 Cr – ₹10 Cr</option>
                <option value="above_10cr">Above ₹10 Cr (TDS 194Q)</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ws-addr">Business Address</label>
            <textarea
              id="ws-addr"
              rows={2}
              disabled={!isOwner}
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
            />
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="ws-cname">Primary Contact</label>
              <input
                id="ws-cname"
                disabled={!isOwner}
                value={primaryContactName}
                onChange={(e) => setPrimaryContactName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ws-cphone">Contact Phone</label>
              <input
                id="ws-cphone"
                type="tel"
                disabled={!isOwner}
                value={primaryContactPhone}
                onChange={(e) => setPrimaryContactPhone(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ws-cemail">Contact Email</label>
              <input
                id="ws-cemail"
                type="email"
                disabled={!isOwner}
                value={primaryContactEmail}
                onChange={(e) => setPrimaryContactEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="ws-lang">Default Outreach Language</label>
              <select
                id="ws-lang"
                disabled={!isOwner}
                value={defaultOutreachLang}
                onChange={(e) =>
                  setDefaultOutreachLang(e.target.value as WorkspaceProfile['defaultOutreachLang'])
                }
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
              <label>Color Scheme (Theme Override)</label>
              <div className="row" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${themePref === 'system' ? 'btn-primary' : ''}`}
                  onClick={() => handleThemeSelect('system')}
                >
                  <Monitor size={13} /> System
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${themePref === 'light' ? 'btn-primary' : ''}`}
                  onClick={() => handleThemeSelect('light')}
                >
                  <Sun size={13} /> Light
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${themePref === 'dark' ? 'btn-primary' : ''}`}
                  onClick={() => handleThemeSelect('dark')}
                >
                  <Moon size={13} /> Dark
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ws-patch">Company Policy Patch (Accio SKILL.patch.md)</label>
            <textarea
              id="ws-patch"
              rows={2}
              disabled={!isOwner}
              placeholder="e.g. Reject quotes with >10 day delivery lead time. Prefer Net 30-45d MSME-safe credit."
              value={policyPatchMd}
              onChange={(e) => setPolicyPatchMd(e.target.value)}
            />
          </div>

          <VoiceCloneCard initialLanguage={defaultOutreachLang} />

          <div className="card" style={{ padding: 12, background: 'var(--bg-app)', fontSize: 12 }}>
            <strong>DPDP Act 2023 Compliance (Data Principal Rights &amp; Audit Trail)</strong>
            <div className="row" style={{ marginTop: 8 }}>
              <a
                href={`${API_BASE}/api/compliance/export-data`}
                className="btn btn-sm"
                target="_blank"
                rel="noreferrer"
              >
                <Download size={13} /> Export Full Workspace JSON
              </a>
              {isOwner && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    const phrase = window.prompt(
                      'DPDP Right to Erasure: Type ERASE WORKSPACE to permanently delete all suppliers, RFQs, POs, invoices, leaks AND stored files (audit receipt preserved).'
                    );
                    if (phrase !== 'ERASE WORKSPACE') return;
                    await apiJson('/api/compliance/erase-workspace', {
                      method: 'DELETE',
                      body: JSON.stringify({ confirmPhrase: phrase }),
                    });
                    onClose();
                    window.location.reload();
                  }}
                >
                  <Trash2 size={13} /> Erase Workspace &amp; Files
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: TEAM & ROLES */}
      {tab === 'team' && (
        <div className="stack">
          {teamMsg && (
            <div className="alert-banner alert-success" role="status">
              <CheckCircle2 size={14} />
              <span>{teamMsg}</span>
            </div>
          )}

          {lastInviteLink && (
            <div className="card" style={{ padding: 12, background: 'var(--accent-soft)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Shareable Invitation Link (valid 7 days):
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <code className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', flex: 1 }}>
                  {lastInviteLink}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    navigator.clipboard?.writeText(lastInviteLink).catch(() => {});
                    setCopiedLink(true);
                  }}
                >
                  <Copy size={13} /> {copiedLink ? 'Copied' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}

          {isOwner && (
            <form onSubmit={handleCreateInvitation} className="card" style={{ padding: 14, background: 'var(--bg-app)' }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>
                <UserPlus size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                Invite Team Member or Chartered Accountant
              </h3>
              <div className="grid-3" style={{ gap: 8 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="inv-email">Email *</label>
                  <input
                    id="inv-email"
                    type="email"
                    required
                    spellCheck={false}
                    placeholder="ca@firm.in"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="inv-name">Full Name</label>
                  <input
                    id="inv-name"
                    placeholder="CA Rajesh Sharma"
                    value={invName}
                    onChange={(e) => setInvName(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="inv-role">Role *</label>
                  <select
                    id="inv-role"
                    value={invRole}
                    onChange={(e) => setInvRole(e.target.value as UserRole)}
                  >
                    <option value="clerk">Purchase Clerk (RFQs/Quotes/Bills)</option>
                    <option value="ca">CA / Auditor (Strict Read-Only)</option>
                    <option value="owner">Workspace Owner (Full Admin)</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}>
                  {inviting ? 'Creating invitation...' : 'Create Invitation Link'}
                </button>
              </div>
            </form>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 13.5 }}>Active Workspace Members ({members.length})</h3>
            <div className="stack" style={{ gap: 8 }}>
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.email}</div>
                  </div>
                  <div className="row">
                    {isOwner ? (
                      <select
                        aria-label={`Role for ${m.email}`}
                        value={m.role}
                        onChange={(e) => handleChangeRole(m.userId, e.target.value as UserRole)}
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        <option value="owner">Owner</option>
                        <option value="clerk">Purchase Clerk</option>
                        <option value="ca">CA (Read-Only)</option>
                      </select>
                    ) : (
                      <span className="pill mono">{m.role.toUpperCase()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isOwner && invitations.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 13.5 }}>Invitations ({invitations.length})</h3>
              <div className="stack" style={{ gap: 6 }}>
                {invitations.map((inv) => {
                  const status = inv.acceptedAt
                    ? 'Accepted'
                    : inv.revokedAt
                      ? 'Revoked'
                      : new Date(inv.expiresAt) <= new Date()
                        ? 'Expired'
                        : 'Pending';
                  return (
                    <div
                      key={inv.id}
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 12.5,
                      }}
                    >
                      <div>
                        <strong>{inv.email}</strong>{' '}
                        <span className="pill mono" style={{ marginLeft: 4 }}>
                          {inv.role.toUpperCase()}
                        </span>
                        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                          {status} · Expires {inv.expiresAt.slice(0, 10)}
                        </span>
                      </div>
                      {status === 'Pending' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => handleRevokeInvite(inv.id)}
                        >
                          <XCircle size={13} /> Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PERSISTENT FILE VAULT & INTEGRATION STATUS */}
      {tab === 'vault' && (
        <div className="stack">
          <div className="card" style={{ padding: 12, background: 'var(--bg-app)', fontSize: 12 }}>
            <strong>Live Infrastructure &amp; Integration Status</strong>
            <div className="mono" style={{ marginTop: 8, display: 'grid', gap: 4, color: 'var(--text-secondary)' }}>
              <div>Database: <strong>{health?.dbMode || 'unknown'}</strong> (Migrations: {health?.appliedMigrations?.join(', ') || 'none'})</div>
              <div>
                File Vault:{' '}
                <strong>
                  {health?.storageEngine === 'cloudflare_r2_binding' || health?.storageEngine === 'cloudflare_r2_s3'
                    ? `Cloudflare R2 Live (${health.storageEngine})`
                    : 'Local Dev Disk Vault (Configure R2_* env vars or VAULT_BUCKET for Cloudflare R2)'}
                </strong>
              </div>
              <div>AI Vision/OCR: <strong>{health?.aiExtractionEngine}</strong></div>
              <div>Voice ASR: <strong>{health?.voiceAsrEngine}</strong> · TTS: <strong>{health?.voiceNoteTtsEnabled ? 'ElevenLabs Live' : 'Unconfigured'}</strong></div>
              <div>Email: <strong>{health?.emailEngine}</strong> · WhatsApp: <strong>{health?.whatsappEngine}</strong></div>
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 13.5 }}>
              Workspace Retained Documents ({files.length})
            </h3>
            {files.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                No documents uploaded or PO PDFs archived yet. Uploaded PDFs, images, spreadsheets, audio recordings, and approved PO PDFs appear here.
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{f.originalFileName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {f.category.toUpperCase()} · {formatBytes(f.sizeBytes)} · {f.storageProvider}
                      </div>
                    </div>
                    <div className="row">
                      <a
                        href={`${API_BASE}/api/files/${f.id}/download`}
                        className="btn btn-sm"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download size={13} /> Download
                      </a>
                      {!isCa && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteFile(f.id)}
                          aria-label={`Delete ${f.originalFileName}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: CRYPTOGRAPHIC TAMPER-EVIDENT AUDIT TRAIL */}
      {tab === 'audit' && (
        <div className="stack">
          {chainReport && (
            <div
              className={`alert-banner ${chainReport.valid ? 'alert-success' : 'alert-danger'}`}
              role="status"
            >
              {chainReport.valid ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <div>
                <strong>
                  {chainReport.valid
                    ? `SHA-256 Audit Chain Verified (${chainReport.verifiedEntries}/${chainReport.totalEntries} entries intact)`
                    : `Audit Chain Tampering Detected: ${chainReport.reason}`}
                </strong>
                {chainReport.latestHash && (
                  <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>
                    Latest Hash: {chainReport.latestHash.slice(0, 24)}…
                  </div>
                )}
              </div>
            </div>
          )}

          {auditLogs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No audit entries recorded yet.</div>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 340, overflowY: 'auto' }}>
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    fontSize: 12,
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <span className="pill mono" style={{ marginRight: 6 }}>#{log.seqNum}</span>
                      <strong>{log.action}</strong>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                        ({log.entityType}{log.entityId ? `:${log.entityId}` : ''})
                      </span>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(log.createdAt).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                    Actor: {log.actorEmail} ({log.actorRole.toUpperCase()})
                    {log.entryHash ? ` · SHA-256: ${log.entryHash.slice(0, 14)}…` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
