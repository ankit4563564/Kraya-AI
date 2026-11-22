-- Migration 0007: Enterprise Procurement Lifecycle Frameworks
-- 1. Supplier Onboarding States, D&B Financial Health, ESG Scores & Continuous Risk Events
-- 2. Contract Intelligence & NLP Clause Redlining (supplier_contracts)
-- 3. Cost-Center Budgets & Multi-Tier Purchase Requisitions (procurement_budgets, purchase_requisitions)
-- 4. Closed-Loop Post-Transaction Performance Data Lake (supplier_performance_logs)
-- 5. Gradual AI Rollout & Autonomy Governance Config on Workspaces

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS autonomy_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS financial_health_score INTEGER NOT NULL DEFAULT 80;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS esg_score INTEGER NOT NULL DEFAULT 75;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS risk_status TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS duns_number TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_risk_assessed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS supplier_risk_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL DEFAULT 'dnb_risk_feed',
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'high',
  previous_financial_score INTEGER,
  new_financial_score INTEGER,
  region_or_category TEXT,
  summary TEXT NOT NULL,
  recommended_alternatives_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggered_rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_contracts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  po_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  contract_number TEXT NOT NULL,
  title TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'msa',
  status TEXT NOT NULL DEFAULT 'under_review',
  effective_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  notice_period_days INTEGER NOT NULL DEFAULT 30,
  contract_value_paise BIGINT NOT NULL DEFAULT 0,
  raw_contract_text TEXT NOT NULL,
  clause_risks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_redlines_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_score INTEGER NOT NULL DEFAULT 100,
  file_id TEXT,
  approved_by TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_budgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  category TEXT NOT NULL,
  period_key TEXT NOT NULL,
  allocated_paise BIGINT NOT NULL,
  committed_paise BIGINT NOT NULL DEFAULT 0,
  spent_paise BIGINT NOT NULL DEFAULT 0,
  hard_stop BOOLEAN NOT NULL DEFAULT TRUE,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pr_number TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'Operations',
  category TEXT NOT NULL DEFAULT 'General',
  requested_by TEXT NOT NULL,
  budget_id TEXT REFERENCES procurement_budgets(id) ON DELETE SET NULL,
  estimated_total_paise BIGINT NOT NULL,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  justification TEXT,
  urgency TEXT NOT NULL DEFAULT 'standard',
  approval_tier_required TEXT NOT NULL DEFAULT 'tier_1_manager',
  budget_check_status TEXT NOT NULL DEFAULT 'within_budget',
  policy_violations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  approved_by TEXT,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  linked_rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  linked_po_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_performance_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  event_source TEXT NOT NULL,
  related_entity_id TEXT,
  on_time_delivery_score INTEGER,
  quantity_fill_rate_pct DOUBLE PRECISION,
  invoice_accuracy_score INTEGER,
  rfq_response_hours DOUBLE PRECISION,
  previous_reliability_score INTEGER NOT NULL,
  new_reliability_score INTEGER NOT NULL,
  notes TEXT,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_ws_num ON supplier_contracts(workspace_id, contract_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_ws_dept_cat_period ON procurement_budgets(workspace_id, department, category, period_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prs_ws_num ON purchase_requisitions(workspace_id, pr_number);

CREATE INDEX IF NOT EXISTS idx_risk_events_ws_sup ON supplier_risk_events(workspace_id, supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_ws_exp ON supplier_contracts(workspace_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_prs_ws_status ON purchase_requisitions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_perf_logs_ws_sup ON supplier_performance_logs(workspace_id, supplier_id, recorded_at DESC);
