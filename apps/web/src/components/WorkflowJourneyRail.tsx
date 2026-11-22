import React, { useState } from 'react';
import {
  Check,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { SummaryStats } from '../lib/api';
import {
  computeWorkspaceGuidance,
  NavTab,
  WORKFLOW_STAGES,
  WorkflowStageDef,
  WorkflowStageId,
} from '../lib/workflow';

interface Props {
  summary: SummaryStats | null;
  activeTab: NavTab;
  onSelectStage: (stage: WorkflowStageDef) => void;
  onRunRecommendedPrompt: (prompt: string, channel: string, tab: NavTab) => void;
}

export function WorkflowJourneyRail({
  summary,
  activeTab,
  onSelectStage,
  onRunRecommendedPrompt,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const guidance = computeWorkspaceGuidance(summary);

  const isStageHighlightedForTab = (stageId: WorkflowStageId): boolean => {
    if (activeTab === 'buying') return stageId === 'source_rfq' || stageId === 'collect_quotes' || stageId === 'negotiate_po';
    if (activeTab === 'daily') return stageId === 'receive_track' || stageId === 'audit_settle';
    if (activeTab === 'inbox') return stageId === 'collect_quotes';
    if (activeTab === 'suppliers') return stageId === 'source_rfq';
    return stageId === guidance.recommendedStage;
  };

  return (
    <section className="workflow-rail-shell" aria-label="Procurement workflow progress">
      <div className="workflow-rail-top">
        <div className="workflow-rail-headline">
          <span className="workflow-rail-badge">
            <Sparkles size={12} aria-hidden="true" />
            Guided Flow
          </span>
          <strong className="workflow-rail-title">{guidance.headline}</strong>
          <span className="workflow-rail-sub">{guidance.subtext}</span>
        </div>

        <div className="workflow-rail-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              const targetStage = WORKFLOW_STAGES.find((s) => s.id === guidance.recommendedStage);
              onRunRecommendedPrompt(
                guidance.ctaPrompt,
                targetStage?.channel || 'manual',
                guidance.ctaTab
              );
            }}
          >
            {guidance.ctaLabel} <ArrowRight size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-sm workflow-rail-toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}
            <span>{collapsed ? 'Show 5 Steps' : 'Hide Steps'}</span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <nav aria-label="Five-step procurement lifecycle">
          <ol className="workflow-steps-list">
            {WORKFLOW_STAGES.map((stage) => {
              const status = guidance.stageStatus[stage.id];
              const count = guidance.stageCounts[stage.id];
              const isRec = stage.id === guidance.recommendedStage;
              const isTabMatch = isStageHighlightedForTab(stage.id);

              return (
                <li key={stage.id} className="workflow-step-item">
                  <button
                    type="button"
                    className={`workflow-step-btn is-${status} ${isRec ? 'is-recommended' : ''} ${isTabMatch ? 'is-in-view' : ''}`}
                    aria-current={isRec ? 'step' : undefined}
                    onClick={() => onSelectStage(stage)}
                  >
                    <span className="workflow-step-num" aria-hidden="true">
                      {status === 'completed' ? <Check size={12} strokeWidth={3} /> : stage.stepNumber}
                    </span>
                    <span className="workflow-step-copy">
                      <span className="workflow-step-label">
                        {stage.shortTitle}
                        {count > 0 && <span className="workflow-step-count mono">{count}</span>}
                      </span>
                      <span className="workflow-step-hint">
                        {isRec ? 'Recommended next' : stage.nextStageHint.replace(/^Next →\s*/, '')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </section>
  );
}

interface NextStepBannerProps {
  stepLabel: string;
  title: string;
  description: string;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function NextStepBanner({
  stepLabel,
  title,
  description,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: NextStepBannerProps) {
  return (
    <div className="next-step-banner">
      <div className="next-step-banner-copy">
        <span className="pill pill-accent" style={{ fontSize: 11 }}>
          {stepLabel}
        </span>
        <div>
          <strong style={{ fontSize: 13.5, display: 'block' }}>{title}</strong>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{description}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {secondaryActionLabel && onSecondaryAction && (
          <button type="button" className="btn btn-sm" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={onPrimaryAction}>
          {primaryActionLabel} <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
