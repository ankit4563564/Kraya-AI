import React, { useEffect, useState } from 'react';
import {
  Brain,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { apiJson, formatINR } from '../lib/api';
import { ModalDialog } from './ModalDialog';

export interface AgentConditionEval {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'info';
  detail: string;
  metric?: string;
  statutoryRef?: string;
}

export interface AgentWhatIf {
  id: string;
  title: string;
  assumption: string;
  impactSummary: string;
  financialDeltaPaise?: number;
  recommendation: string;
}

export interface AgentProposedAction {
  id: string;
  title: string;
  actionType: string;
  requiresHumanApproval: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  rationale: string;
}

export interface SpecialistAgentReportUi {
  agentId: string;
  agentName: string;
  roleTitle: string;
  brainMode: string;
  modelUsed?: string;
  timestamp: string;
  detectedState: string;
  possibleNextStates: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  headline: string;
  executiveVerdict: string;
  reasoningSteps: string[];
  conditionsEvaluated: AgentConditionEval[];
  whatIfScenarios: AgentWhatIf[];
  proposedActions: AgentProposedAction[];
  groundingSources?: Array<{ title: string; uri: string }>;
}

interface FleetEntry {
  agentId: string;
  agentName: string;
  stepNumber: number;
  stepName: string;
  roleTitle: string;
  primarySkills: string[];
  statesHandled: string[];
  realTimeSignals: string[];
  lastRun: {
    id: string;
    detectedState: string;
    riskLevel: string;
    confidence: number;
    headline: string;
    brainMode: string;
    createdAt: string;
  } | null;
}

interface FleetResponse {
  fleet: FleetEntry[];
  realTimeContext: {
    fx: { usdInr: number; eurInr: number; cnyInr: number; source: string };
    regulatoryClock: {
      todayIso: string;
      financialYear: string;
      daysToMarch31TaxCliff: number;
      isMarch31MsmeRedZone: boolean;
      daysToNextGstr1: number;
      daysToNextGstr2b: number;
      daysToNextGstr3b: number;
      msme43bhPenaltyInterestPct: number;
      activeAlerts: string[];
    };
  };
  morningCronSchedule: {
    cronUtc: string;
    humanSchedule: string;
  };
  aiCapabilities: {
    geminiLiveEnabled: boolean;
    geminiModel: string;
    liveGstnApiEnabled: boolean;
    googleMapsEnabled: boolean;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function riskPillClass(risk: string): string {
  if (risk === 'critical' || risk === 'high') return 'pill-critical';
  if (risk === 'medium') return 'pill-warning';
  return 'pill-success';
}

export function AgentFleetModal({ open, onClose }: Props) {
  const [fleetData, setFleetData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<SpecialistAgentReportUi | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadFleet = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<FleetResponse>('/api/agents/fleet');
      setFleetData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Specialist Agent Fleet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadFleet();
    }
  }, [open]);

  const handleRunAgent = async (agentId: string) => {
    setRunningAgentId(agentId);
    setError(null);
    try {
      const res = await apiJson<{ runId: string; report: SpecialistAgentReportUi }>(
        '/api/agents/run',
        {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            promptText: customPrompt.trim() || undefined,
            query: customPrompt.trim() || undefined,
          }),
        }
      );
      setActiveReport(res.report);
      loadFleet();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to run ${agentId} agent`);
    } finally {
      setRunningAgentId(null);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Specialist AI Procurement Engines"
      footer={
        <>
          <button type="button" className="btn" onClick={loadFleet} disabled={loading}>
            <RefreshCw size={13} /> Refresh Live Signals
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {error && (
        <div
          className="card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            padding: 10,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Real-Time Indian Market & Regulatory Context Strip */}
      {fleetData && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 14,
            background: 'var(--bg-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="pill pill-accent">
              <Sparkles size={11} /> {fleetData.realTimeContext.regulatoryClock.financialYear}
            </span>
            <span className="pill mono">
              USD/INR ₹{fleetData.realTimeContext.fx.usdInr}
            </span>
            <span
              className={`pill ${fleetData.realTimeContext.regulatoryClock.isMarch31MsmeRedZone ? 'pill-danger' : 'pill-success'}`}
            >
              Mar 31 43B(h): {fleetData.realTimeContext.regulatoryClock.daysToMarch31TaxCliff}d
            </span>
            <span className="pill">
              GSTR-2B in {fleetData.realTimeContext.regulatoryClock.daysToNextGstr2b}d · GSTR-3B in{' '}
              {fleetData.realTimeContext.regulatoryClock.daysToNextGstr3b}d
            </span>
            <span className="pill">
              <Clock size={11} /> Cron: {fleetData.morningCronSchedule.humanSchedule}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            LLM:{' '}
            <strong>
              {fleetData.aiCapabilities.geminiLiveEnabled
                ? `Gemini Live (${fleetData.aiCapabilities.geminiModel})`
                : 'Deterministic Neuro-Symbolic'}
            </strong>{' '}
            · GSTN:{' '}
            <strong>
              {fleetData.aiCapabilities.liveGstnApiEnabled ? 'Live API' : 'Offline Mod-36 + Portal'}
            </strong>
          </div>
        </div>
      )}

      {/* Optional context input for Orchestrator / Intake / Sourcing */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="agent-prompt-input" style={{ fontSize: 12 }}>
          Optional Scenario / Query (used when running Orchestrator, Intake, or Sourcing Agent)
        </label>
        <input
          id="agent-prompt-input"
          placeholder="e.g. Corrugated 5-ply boxes Bengaluru Net 30d OR Ramesh quoted 22+gst bhada 4500..."
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
        />
      </div>

      {/* 8 Specialist Agent Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        {(fleetData?.fleet || []).map((agent) => (
          <div
            key={agent.agentId}
            className="card"
            style={{
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="pill" style={{ fontSize: 10 }}>
                  Step {agent.stepNumber}
                </span>
                {agent.lastRun && (
                  <span className={`pill ${riskPillClass(agent.lastRun.riskLevel)}`} style={{ fontSize: 10 }}>
                    {agent.lastRun.detectedState.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 6 }}>{agent.agentName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                {agent.roleTitle}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                Handles {agent.statesHandled.length} states · {agent.realTimeSignals.slice(0, 2).join(', ')}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={runningAgentId !== null}
              onClick={() => handleRunAgent(agent.agentId)}
            >
              <Play size={12} />{' '}
              {runningAgentId === agent.agentId ? 'Thinking...' : 'Run Agent Mind'}
            </button>
          </div>
        ))}
      </div>

      {/* Active Specialist Agent Reasoning Inspector */}
      {activeReport && (
        <div
          className="card"
          style={{
            padding: 16,
            border: '1px solid var(--accent)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <Brain size={18} />
              <strong>{activeReport.agentName}</strong>
              <span className={`pill ${riskPillClass(activeReport.riskLevel)}`}>
                State: {activeReport.detectedState.replace(/_/g, ' ')}
              </span>
              <span className="pill mono">
                {Math.round(activeReport.confidence * 100)}% conf
              </span>
            </div>
            <span className="pill" style={{ fontSize: 10.5 }}>
              {activeReport.brainMode.replace(/_/g, ' ')}
            </span>
          </div>

          <h4 style={{ margin: '10px 0 4px', fontSize: 15 }}>{activeReport.headline}</h4>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {activeReport.executiveVerdict}
          </p>

          {/* Reasoning Trace */}
          {activeReport.reasoningSteps.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Agent Thinking Trace
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
                {activeReport.reasoningSteps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Conditions Evaluated */}
          {activeReport.conditionsEvaluated.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Conditions &amp; Guardrails Checked ({activeReport.conditionsEvaluated.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeReport.conditionsEvaluated.map((cond) => (
                  <div
                    key={cond.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--bg-subtle)',
                      fontSize: 12.5,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                    }}
                  >
                    {cond.status === 'pass' && <CheckCircle2 size={14} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    {cond.status === 'warning' && <AlertTriangle size={14} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    {cond.status === 'fail' && <XCircle size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    {cond.status === 'info' && <Info size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {cond.label}{' '}
                        {cond.metric && <span className="pill mono" style={{ fontSize: 10, marginLeft: 4 }}>{cond.metric}</span>}
                        {cond.statutoryRef && (
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 6 }}>
                            [{cond.statutoryRef}]
                          </span>
                        )}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{cond.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What-If Simulations */}
          {activeReport.whatIfScenarios.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                What-If Scenario Simulations
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                {activeReport.whatIfScenarios.map((sc) => (
                  <div key={sc.id} className="card" style={{ padding: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{sc.title}</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 3 }}>{sc.impactSummary}</div>
                    {typeof sc.financialDeltaPaise === 'number' && sc.financialDeltaPaise !== 0 && (
                      <div className="mono" style={{ marginTop: 4, fontWeight: 600 }}>
                        Impact: {sc.financialDeltaPaise < 0 ? `Save ${formatINR(Math.abs(sc.financialDeltaPaise))}` : `+${formatINR(sc.financialDeltaPaise)}`}
                      </div>
                    )}
                    <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--accent)' }}>
                      → {sc.recommendation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proposed Actions (Gated) */}
          {activeReport.proposedActions.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Recommended Next Actions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeReport.proposedActions.map((act) => (
                  <div
                    key={act.id}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12.5,
                    }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{act.title}</strong>
                      <span className="pill" style={{ fontSize: 10 }}>
                        {act.requiresHumanApproval ? 'Approval Gated' : 'Safe Read/Check'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{act.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
