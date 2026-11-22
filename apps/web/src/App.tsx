import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Inbox,
  ShoppingBag,
  CalendarCheck,
  Users,
  Settings,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  LogIn,
  Eye,
  Brain,
  Plug,
  Sun,
  Moon,
} from 'lucide-react';
import {
  ApiError,
  apiJson,
  AuthMeResponse,
  formatINR,
  HealthInfo,
  setStoredAuthToken,
  setUnauthorizedListener,
  SummaryStats,
  UserRole,
  WorkspaceProfile,
} from './lib/api';
import { AuthView } from './views/AuthView';
import { AuthModal } from './components/AuthModal';
import { OnboardingWizard } from './views/OnboardingWizard';
import { NewTaskView } from './views/NewTaskView';
import { UnifiedInboxView } from './views/UnifiedInboxView';
import { BuyingRfqsView } from './views/BuyingRfqsView';
import { MaintenanceDailyView } from './views/MaintenanceDailyView';
import { SuppliersView } from './views/SuppliersView';
import { WorkspaceSettingsModal } from './components/WorkspaceSettingsModal';
import { OutreachModal, OutreachModalRequest } from './components/OutreachModal';
import { AgentFleetModal } from './components/AgentFleetModal';
import { ConnectorHubModal } from './components/ConnectorHubModal';
import { EnterpriseLifecycleModal } from './components/EnterpriseLifecycleModal';
import { LegalComplianceModal } from './components/LegalComplianceModal';
import { SupplierDiscoveryModal } from './components/SupplierDiscoveryModal';
import { BomBulkImportModal } from './components/BomBulkImportModal';
import { Gstr2bReconcilerModal } from './components/Gstr2bReconcilerModal';
import { NegotiationModal, RfqNegotiationData } from './components/NegotiationModal';
import { WorkflowJourneyRail } from './components/WorkflowJourneyRail';
import { GlobalPromptDock } from './components/GlobalPromptDock';
import { GlobalWorkflowTools, NavTab, WorkflowStageDef, WorkflowStageId } from './lib/workflow';

const TAB_TITLES: Record<NavTab, string> = {
  new_task: 'Procurement Studio | Kraya AI',
  inbox: 'Unified Inbox | Kraya AI',
  buying: 'Buying & RFQs | Kraya AI',
  daily: 'Maintenance & Invoice Audit | Kraya AI',
  suppliers: 'Supplier Directory | Kraya AI',
};

const roleBadgeLabel = (role: UserRole): string => {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'clerk':
      return 'Purchaser';
    case 'ca':
      return 'CA Auditor';
    default:
      return 'Member';
  }
};

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authMe, setAuthMe] = useState<AuthMeResponse | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('new_task');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceProfile | null>(null);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAgentFleet, setShowAgentFleet] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const [showEnterpriseHub, setShowEnterpriseHub] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<'plans' | 'dpdp' | 'terms' | null>(null);
  const [outreachReq, setOutreachReq] = useState<OutreachModalRequest | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Global workflow modals so prompts work seamlessly from ANY page
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [discoverInitialQuery, setDiscoverInitialQuery] = useState('');
  const [showBomModal, setShowBomModal] = useState(false);
  const [bomInitialCsv, setBomInitialCsv] = useState('');
  const [showGstr2bModal, setShowGstr2bModal] = useState(false);
  const [showNegotiationModal, setShowNegotiationModal] = useState(false);
  const [negotiationData, setNegotiationData] = useState<RfqNegotiationData | null>(null);
  const [prefillPrompt, setPrefillPrompt] = useState<{
    text: string;
    channel?: string;
    stageId?: WorkflowStageId;
    nonce: number;
  } | null>(null);

  // Detect ?invite= or ?reset= URL params for invite acceptance & password reset flows
  const urlParams = new URLSearchParams(window.location.search);
  const initialInviteToken = urlParams.get('invite');
  const initialResetToken = urlParams.get('reset');

  const loadAuthenticatedWorkspace = useCallback(async () => {
    try {
      const [me, h] = await Promise.all([
        apiJson<AuthMeResponse>('/api/auth/me'),
        apiJson<HealthInfo>('/api/health'),
      ]);
      setAuthMe(me);
      setWorkspace(me.workspace);
      setHealth(h);

      if (me.authenticated || !me.requireAuthMode) {
        const sum = await apiJson<SummaryStats>('/api/summary');
        setSummary(sum);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthMe(null);
        setWorkspace(null);
        setSummary(null);
      }
      apiJson<HealthInfo>('/api/health').then(setHealth).catch(() => {});
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const refreshGlobal = useCallback(() => {
    setRefreshTick((t) => t + 1);
    Promise.all([
      apiJson<WorkspaceProfile>('/api/workspace'),
      apiJson<SummaryStats>('/api/summary'),
      apiJson<HealthInfo>('/api/health'),
    ])
      .then(([ws, sum, h]) => {
        setWorkspace(ws);
        setSummary(sum);
        setHealth(h);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = TAB_TITLES[activeTab] || 'Kraya AI — Procurement Platform';
  }, [activeTab]);

  useEffect(() => {
    setUnauthorizedListener(() => {
      setAuthMe(null);
      setWorkspace(null);
      setSummary(null);
      setShowAuthModal(true);
    });
    loadAuthenticatedWorkspace();

    const storedTheme = (localStorage.getItem('color-scheme') || 'light') as 'light' | 'dark';
    setTheme(storedTheme);
    document.documentElement.setAttribute('data-theme', storedTheme);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', storedTheme);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const val = (e.newValue === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
        setTheme(val);
        const m = document.querySelector('meta[name="color-scheme"]');
        if (m) m.setAttribute('content', val);
        document.documentElement.setAttribute('data-theme', val);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      setUnauthorizedListener(null);
      window.removeEventListener('storage', onStorage);
    };
  }, [loadAuthenticatedWorkspace]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('color-scheme', next);
    document.documentElement.setAttribute('data-theme', next);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', next);
  };

  const handleLogout = async () => {
    setStoredAuthToken(null);
    await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthMe(null);
    setWorkspace(null);
    setSummary(null);
    setActiveTab('new_task');
    await loadAuthenticatedWorkspace();
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    await apiJson('/api/auth/switch-workspace', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
    await loadAuthenticatedWorkspace();
  };

  if (authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ textAlign: 'center', padding: 36 }}>
          <div className="brand-mark" style={{ margin: '0 auto 14px', width: 36, height: 36, fontSize: 16 }}>K</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Connecting to Kraya workspace...</div>
        </div>
      </div>
    );
  }

  // Show AuthView if invite/reset token is in URL
  if (initialInviteToken || initialResetToken) {
    return (
      <AuthView
        initialInviteToken={initialInviteToken}
        initialResetToken={initialResetToken}
        onAuthenticated={() => {
          setAuthLoading(true);
          loadAuthenticatedWorkspace();
        }}
      />
    );
  }

  // If strict auth is required and user is not authenticated, render AuthView
  const isAuthed = Boolean(authMe && (authMe.authenticated || !authMe.requireAuthMode));
  const strictAuthActive = Boolean(authMe?.requireAuthMode || health?.requireAuth !== false);
  if (!isAuthed && strictAuthActive) {
    return (
      <AuthView
        initialInviteToken={initialInviteToken}
        initialResetToken={initialResetToken}
        onAuthenticated={() => {
          setAuthLoading(true);
          loadAuthenticatedWorkspace();
        }}
      />
    );
  }

  // Company Onboarding Gate for newly registered Owners
  if (authMe?.needsOnboarding && workspace) {
    return (
      <OnboardingWizard
        workspace={workspace}
        userEmail={authMe.user?.email || authMe.email}
        userName={authMe.user?.name || ''}
        onCompleted={(updated) => {
          setWorkspace(updated);
          setAuthMe((prev) => (prev ? { ...prev, workspace: updated, needsOnboarding: false } : prev));
          refreshGlobal();
        }}
        onLogout={handleLogout}
      />
    );
  }

  const userRole: UserRole = authMe?.role || 'owner';
  const isCaReadOnly = userRole === 'ca';

  // Exact 5 Navigation Tabs
  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    badge?: number;
  }> = [
    { id: 'new_task', label: 'Studio', icon: Plus },
    { id: 'inbox', label: 'Inbox', icon: Inbox, badge: summary?.inboxCount || undefined },
    { id: 'buying', label: 'Buying & RFQs', icon: ShoppingBag, badge: summary?.openRfqsCount || undefined },
    { id: 'daily', label: 'Daily & Audit', icon: CalendarCheck, badge: summary?.openTasksCount || undefined },
    { id: 'suppliers', label: 'Suppliers', icon: Users, badge: summary?.suppliersCount || undefined },
  ];

  const handleSelectNav = (id: NavTab) => {
    setActiveTab(id);
    setMobileMenuOpen(false);
  };

  const handleOpenNegotiationGlobal = async (rfqId?: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      let targetId = rfqId;
      if (!targetId) {
        const rfqsList = await apiJson<Array<{ id: string; quotesCount: number; status: string }>>('/api/rfqs');
        const eligible = rfqsList.find((r) => r.quotesCount >= 2 && r.status !== 'closed') ?? rfqsList.find((r) => r.quotesCount >= 2);
        if (!eligible) {
          return {
            ok: false,
            message:
              rfqsList.length === 0
                ? 'No open RFQs found yet. Create an RFQ and log at least 2 supplier quotes first.'
                : 'Your open RFQ needs at least 2 supplier quotes to calculate BATNA spread and counter-offer targets.',
          };
        }
        targetId = eligible.id;
      }
      const data = await apiJson<RfqNegotiationData>(`/api/rfqs/${targetId}/negotiation-strategy`, {
        method: 'POST',
      });
      setNegotiationData(data);
      setShowNegotiationModal(true);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Could not load AI negotiation playbook.',
      };
    }
  };

  const workflowTools: GlobalWorkflowTools = {
    onNavigate: handleSelectNav,
    onOpenOutreach: setOutreachReq,
    onOpenDiscover: (initialQuery = '') => {
      setDiscoverInitialQuery(initialQuery);
      setShowDiscoverModal(true);
    },
    onOpenBomImport: (initialCsv = '') => {
      setBomInitialCsv(initialCsv);
      setShowBomModal(true);
    },
    onOpenGstr2b: () => setShowGstr2bModal(true),
    onOpenNegotiation: handleOpenNegotiationGlobal,
    onDataMutated: refreshGlobal,
  };

  const handleSelectWorkflowStage = (stage: WorkflowStageDef) => {
    if (activeTab === stage.primaryTab) {
      setPrefillPrompt({
        text: stage.defaultPrompt,
        channel: stage.channel,
        stageId: stage.id,
        nonce: Date.now(),
      });
    } else {
      handleSelectNav(stage.primaryTab);
      setPrefillPrompt({
        text: stage.defaultPrompt,
        channel: stage.channel,
        stageId: stage.id,
        nonce: Date.now(),
      });
    }
  };

  const handleRunRecommendedPrompt = (promptText: string, ch: string, targetTab: NavTab) => {
    if (targetTab !== activeTab) {
      handleSelectNav(targetTab);
    }
    setPrefillPrompt({
      text: promptText,
      channel: ch,
      nonce: Date.now(),
    });
  };

  return (
    <div className="app-shell">
      {/* Mobile Drawer */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`} aria-label="Main mobile navigation">
        <div className="brand" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="brand-mark">K</div>
            <div className="brand-text">
              <strong>Kraya</strong>
              <span className="brand-badge">B2B</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                aria-current={activeTab === item.id ? 'page' : undefined}
                onClick={() => handleSelectNav(item.id)}
              >
                <span className="nav-item-left">
                  <Icon size={16} />
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="nav-badge mono">{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {authMe?.authenticated && authMe.user ? (
            <div>
              <strong>{workspace?.legalName || 'Workspace'}</strong>
              <div className="mono" style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)' }}>
                {workspace?.gstin || `State ${workspace?.stateCode || '29'} · WACC ${workspace?.waccPct ?? 15}%`}
              </div>
              <div style={{ fontSize: 11.5, marginTop: 6 }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{authMe.user.name}</div>
                <div style={{ color: 'var(--text-muted)' }}>{authMe.user.email}</div>
                <div style={{ marginTop: 4 }}>
                  <span className="pill" style={{ fontSize: 10 }}>
                    {roleBadgeLabel(userRole)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <strong>{workspace?.legalName || 'Workspace'}</strong>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => setShowAuthModal(true)}
                >
                  <LogIn size={13} /> Sign In
                </button>
              </div>
            </div>
          )}

          {authMe && authMe.workspaces.length > 1 && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ws-switcher" style={{ fontSize: 11 }}>
                Switch Workspace
              </label>
              <select
                id="ws-switcher"
                value={authMe.workspaceId}
                onChange={(e) => handleSwitchWorkspace(e.target.value)}
                style={{ fontSize: 12, padding: '4px 6px' }}
              >
                {authMe.workspaces.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.legalName} ({w.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => setShowSettings(true)}
            >
              <Settings size={13} /> Settings
            </button>
            {authMe?.authenticated && (
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Desktop Container */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="brand" onClick={() => handleSelectNav('new_task')}>
              <div className="brand-mark" aria-hidden="true">K</div>
              <div className="brand-text">
                <strong>Kraya</strong>
                <span className="brand-badge">B2B</span>
              </div>
            </div>
          </div>

          <nav className="top-nav-tabs" aria-label="Main navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`top-nav-item ${activeTab === item.id ? 'active' : ''}`}
                  aria-current={activeTab === item.id ? 'page' : undefined}
                  onClick={() => handleSelectNav(item.id)}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="nav-badge mono">{item.badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="topbar-right">
            <button
              type="button"
              className="btn btn-sm mobile-menu-btn btn-icon"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open mobile navigation"
            >
              <Menu size={16} />
            </button>

            <span className={`leak-counter-pill ${(summary?.totalProtectedPaise ?? 0) > 0 ? 'has-leaks' : ''}`}>
              <ShieldCheck size={13} />
              <span>
                Protected: <strong className="mono">{formatINR(summary?.totalProtectedPaise ?? 0, 0)}</strong>
              </span>
            </span>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowAgentFleet(true)}
              title="Inspect 8 AI Specialist Brains"
            >
              <Brain size={13} />
              <span>AI Engines</span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowConnectors(true)}
              title="ERP, GSTN & External APIs"
            >
              <Plug size={13} />
              <span>APIs</span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowEnterpriseHub(true)}
              title="Enterprise Lifecycle: Risk, Catalogs & P2P"
            >
              <ShieldCheck size={13} />
              <span>Enterprise</span>
            </button>

            {isCaReadOnly && (
              <span className="pill" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                <Eye size={12} /> CA Read-Only
              </span>
            )}

            <button
              type="button"
              className="btn btn-sm btn-icon"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {authMe?.authenticated && authMe.user ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowSettings(true)}
                title="Workspace settings & team"
              >
                <Settings size={13} />
                <span>{workspace?.legalName || authMe.user.email.split('@')[0]}</span>
                <span className="pill" style={{ fontSize: 10, padding: '1px 5px', marginLeft: 2 }}>
                  {roleBadgeLabel(userRole)}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setShowAuthModal(true)}
              >
                <LogIn size={13} /> Sign In
              </button>
            )}

            {authMe?.authenticated && (
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            )}
          </div>
        </header>

        <main className="content-container" key={authMe?.workspaceId || 'ws'}>
          {activeTab !== 'new_task' && (
            <>
              <WorkflowJourneyRail
                summary={summary}
                activeTab={activeTab}
                onSelectStage={handleSelectWorkflowStage}
                onRunRecommendedPrompt={handleRunRecommendedPrompt}
              />
              <GlobalPromptDock
                activeTab={activeTab}
                summary={summary}
                userRole={userRole}
                tools={workflowTools}
                prefillPrompt={prefillPrompt}
              />
            </>
          )}

          {activeTab === 'new_task' && (
            <NewTaskView
              summary={summary}
              userRole={userRole}
              onDataMutated={refreshGlobal}
              onNavigate={handleSelectNav}
              onOpenOutreach={setOutreachReq}
              tools={workflowTools}
              prefillPrompt={prefillPrompt}
            />
          )}

          {activeTab === 'inbox' && (
            <UnifiedInboxView
              userRole={userRole}
              onDataMutated={refreshGlobal}
              onNavigate={handleSelectNav}
              refreshTick={refreshTick}
            />
          )}

          {activeTab === 'buying' && (
            <BuyingRfqsView
              userRole={userRole}
              onDataMutated={refreshGlobal}
              onOpenOutreach={setOutreachReq}
              onNavigate={handleSelectNav}
              refreshTick={refreshTick}
            />
          )}

          {activeTab === 'daily' && (
            <MaintenanceDailyView
              userRole={userRole}
              onDataMutated={refreshGlobal}
              onOpenOutreach={setOutreachReq}
              onNavigate={handleSelectNav}
              refreshTick={refreshTick}
            />
          )}

          {activeTab === 'suppliers' && (
            <SuppliersView
              userRole={userRole}
              onDataMutated={refreshGlobal}
              onOpenOutreach={setOutreachReq}
              onNavigate={handleSelectNav}
              refreshTick={refreshTick}
            />
          )}
        </main>

        {activeTab !== 'new_task' && (
          <footer className="canvas-footer">
            <div className="canvas-footer-left">
              <strong>{workspace?.legalName || 'Workspace'}</strong>
              <span className="mono" style={{ fontSize: 11, marginLeft: 6, color: 'var(--text-muted)' }}>
                {workspace?.gstin || `State ${workspace?.stateCode || '29'} · WACC ${workspace?.waccPct ?? 15}%`}
              </span>
              {authMe?.authenticated && authMe.user && (
                <span className="pill" style={{ marginLeft: 6, fontSize: 10 }}>
                  {roleBadgeLabel(userRole)}
                </span>
              )}
            </div>
            <div className="canvas-footer-right">
              Pre-payment verification &amp; CA audit support.{' '}
              <button
                type="button"
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
                onClick={() => setLegalModalTab('plans')}
              >
                Plans
              </button>{' '}
              ·{' '}
              <button
                type="button"
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
                onClick={() => setLegalModalTab('dpdp')}
              >
                DPDP &amp; Compliance
              </button>
            </div>
          </footer>
        )}
      </div>

      {/* Global Modals */}
      <WorkspaceSettingsModal
        open={showSettings}
        workspace={workspace}
        userRole={userRole}
        health={health}
        onClose={() => setShowSettings(false)}
        onSaved={(updated) => {
          setWorkspace(updated);
          refreshGlobal();
        }}
        onDataMutated={refreshGlobal}
      />

      <OutreachModal
        request={outreachReq}
        defaultLanguage={workspace?.defaultOutreachLang || 'english'}
        onClose={() => setOutreachReq(null)}
      />

      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthenticated={() => {
          setShowAuthModal(false);
          loadAuthenticatedWorkspace();
        }}
      />

      <AgentFleetModal
        open={showAgentFleet}
        onClose={() => setShowAgentFleet(false)}
      />

      <ConnectorHubModal
        open={showConnectors}
        onClose={() => setShowConnectors(false)}
      />

      <EnterpriseLifecycleModal
        open={showEnterpriseHub}
        onClose={() => setShowEnterpriseHub(false)}
        onMutated={refreshGlobal}
      />

      <LegalComplianceModal
        open={legalModalTab !== null}
        initialTab={legalModalTab || 'plans'}
        isOwner={userRole === 'owner'}
        onClose={() => setLegalModalTab(null)}
      />

      <SupplierDiscoveryModal
        open={showDiscoverModal}
        onClose={() => setShowDiscoverModal(false)}
        initialQuery={discoverInitialQuery}
        onSupplierAdded={refreshGlobal}
        onOpenOutreach={setOutreachReq}
      />

      <BomBulkImportModal
        open={showBomModal}
        onClose={() => setShowBomModal(false)}
        initialCsvText={bomInitialCsv}
        onImported={() => {
          refreshGlobal();
          handleSelectNav('buying');
        }}
      />

      <Gstr2bReconcilerModal
        open={showGstr2bModal}
        onClose={() => setShowGstr2bModal(false)}
      />

      <NegotiationModal
        open={showNegotiationModal}
        onClose={() => setShowNegotiationModal(false)}
        data={negotiationData}
        onOpenOutreach={setOutreachReq}
      />
    </div>
  );
}
