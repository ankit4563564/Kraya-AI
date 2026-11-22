/**
 * Reproducible, version-controlled SQL migrations for Kraya (PostgreSQL / Neon / PGlite).
 * Mirrors apps/api/migrations/0001_initial_foundation.sql & 0002_auth_onboarding_r2_hardening.sql
 * so Cloudflare Workers (no fs) and Node 22 run identical schema upgrades tracked in `_kraya_migrations`.
 */

export interface SqlMigration {
  version: string;
  name: string;
  sql: string;
}

export const SQL_MIGRATIONS: SqlMigration[] = [
  {
    version: '0001',
    name: 'initial_foundation',
    sql: `
CREATE TABLE IF NOT EXISTS _kraya_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  state_code TEXT NOT NULL DEFAULT '29',
  gst_regime TEXT NOT NULL DEFAULT 'regular',
  wacc_pct DOUBLE PRECISION NOT NULL DEFAULT 15.0,
  turnover_band TEXT NOT NULL DEFAULT 'under_5cr',
  default_outreach_lang TEXT NOT NULL DEFAULT 'english',
  policy_patch_md TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  category TEXT DEFAULT 'General',
  gstin TEXT,
  state_code TEXT,
  gst_regime TEXT NOT NULL DEFAULT 'regular',
  pan_entity_type TEXT,
  udyam_number TEXT,
  udyam_tier TEXT NOT NULL DEFAULT 'unknown',
  e_invoice_required BOOLEAN NOT NULL DEFAULT FALSE,
  credit_days INTEGER NOT NULL DEFAULT 30,
  reliability_score INTEGER NOT NULL DEFAULT 85,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  pillar TEXT NOT NULL DEFAULT 'quote_capture',
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  rfq_id TEXT,
  raw_content TEXT NOT NULL,
  media_file_name TEXT,
  media_mime_type TEXT,
  media_storage_key TEXT,
  transcript_text TEXT,
  parsed_summary TEXT NOT NULL,
  extracted_json JSONB,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  needs_verification BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfqs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rfq_number TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'initial',
  items_json JSONB NOT NULL,
  delivery_due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  source_event_id TEXT REFERENCES source_events(id) ON DELETE SET NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
  raw_rate_rupees DOUBLE PRECISION NOT NULL,
  raw_unit TEXT NOT NULL DEFAULT 'pc',
  normalization_note TEXT,
  base_unit_paise BIGINT NOT NULL,
  gst_pct DOUBLE PRECISION NOT NULL DEFAULT 18,
  is_gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  freight_paise BIGINT NOT NULL DEFAULT 0,
  freight_gst_mode TEXT NOT NULL DEFAULT 'composite_supply',
  credit_days INTEGER NOT NULL DEFAULT 0,
  effective_credit_days INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  net_landed_unit_paise BIGINT NOT NULL,
  credit_adjusted_unit_paise BIGINT NOT NULL,
  price_delta_pct DOUBLE PRECISION,
  flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_verification BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  po_number TEXT NOT NULL,
  po_date TEXT NOT NULL,
  items_json JSONB NOT NULL,
  freight_paise BIGINT NOT NULL DEFAULT 0,
  taxable_paise BIGINT NOT NULL,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  delivery_due_at TEXT NOT NULL,
  invoice_status TEXT NOT NULL DEFAULT 'pending',
  payment_due_at TEXT,
  approved_by TEXT NOT NULL DEFAULT 'Owner',
  approved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id TEXT NOT NULL,
  source_event_id TEXT REFERENCES source_events(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  supplier_gstin TEXT,
  irn TEXT,
  items_json JSONB NOT NULL,
  taxable_paise BIGINT NOT NULL,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  grand_total_paise BIGINT NOT NULL,
  math_reconciled BOOLEAN NOT NULL DEFAULT TRUE,
  po_match_status TEXT NOT NULL DEFAULT 'unlinked',
  ims_suggested_action TEXT NOT NULL DEFAULT 'ACCEPT',
  total_money_leak_paise BIGINT NOT NULL DEFAULT 0,
  flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cfo_verdict TEXT NOT NULL,
  payment_due_at TEXT,
  msme_43bh_due_at TEXT,
  rule37_cliff_at TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoices_ws_sup_num UNIQUE (workspace_id, supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS money_leaks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_event_id TEXT REFERENCES source_events(id) ON DELETE SET NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  quote_id TEXT REFERENCES quotes(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  leak_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  statutory_ref TEXT,
  amount_paise BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',
  dispute_message_draft TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  related_id TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  due_at TEXT NOT NULL,
  suggested_message TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_description TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  net_landed_unit_paise BIGINT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pc',
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS amc_schedules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_name TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  frequency_days INTEGER NOT NULL DEFAULT 90,
  next_due_at TEXT NOT NULL,
  last_rate_paise BIGINT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  dpdp_consent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`,
  },
  {
    version: '0002',
    name: 'auth_onboarding_r2_hardening',
    sql: `
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS business_address TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS primary_contact_name TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS primary_contact_phone TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pdf_file_id TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS file_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS file_id TEXT;
ALTER TABLE source_events ADD COLUMN IF NOT EXISTS file_id TEXT;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'clerk',
  invited_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'clerk',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stored_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'document',
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  source_event_id TEXT REFERENCES source_events(id) ON DELETE SET NULL,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  po_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
SELECT 'mem_' || substr(md5(u.id || u.workspace_id), 1, 12), u.workspace_id, u.id, u.role, u.created_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_memberships m
  WHERE m.workspace_id = u.workspace_id AND m.user_id = u.id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_memberships_ws_user ON workspace_memberships(workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfqs_ws_number ON rfqs(workspace_id, rfq_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_ws_number ON purchase_orders(workspace_id, po_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_ws_quote ON purchase_orders(workspace_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_ws_sup_num ON invoices(workspace_id, supplier_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_receipts_provider_ext ON webhook_receipts(provider, external_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_ws ON suppliers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_source_events_ws_created ON source_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfqs_ws_created ON rfqs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_ws_rfq ON quotes(workspace_id, rfq_id);
CREATE INDEX IF NOT EXISTS idx_pos_ws_created ON purchase_orders(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_ws_created ON invoices(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_money_leaks_ws_status ON money_leaks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_ws_status ON daily_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_price_history_ws_item ON price_history(workspace_id, item_key);
CREATE INDEX IF NOT EXISTS idx_amc_schedules_ws ON amc_schedules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ws_created ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_stored_files_ws_created ON stored_files(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_ws_email ON workspace_invitations(workspace_id, email);
`,
  },
  {
    version: '0003',
    name: 'grn_po_lifecycle_credit_notes_audit_chain',
    sql: `
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS revisions_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS seq_num INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entry_hash TEXT;

CREATE TABLE IF NOT EXISTS grn_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  grn_number TEXT NOT NULL,
  challan_number TEXT,
  received_date TEXT NOT NULL,
  accepted_date TEXT NOT NULL,
  items_json JSONB NOT NULL,
  qc_status TEXT NOT NULL DEFAULT 'accepted',
  notes TEXT,
  file_id TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  voucher_type TEXT NOT NULL DEFAULT 'credit_note',
  voucher_number TEXT NOT NULL,
  voucher_date TEXT NOT NULL,
  taxable_paise BIGINT NOT NULL,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grn_ws_number ON grn_receipts(workspace_id, grn_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_ws_sup_num ON credit_notes(workspace_id, supplier_id, voucher_number);

CREATE INDEX IF NOT EXISTS idx_grn_ws_po ON grn_receipts(workspace_id, po_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_ws_inv ON credit_notes(workspace_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ws_seq ON audit_logs(workspace_id, seq_num ASC);
`,
  },
  {
    version: '0004',
    name: 'agent_brains_gstn_cache_ratelimit',
    sql: `
CREATE TABLE IF NOT EXISTS gstn_verifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  gstin TEXT NOT NULL,
  checksum_valid BOOLEAN NOT NULL DEFAULT TRUE,
  live_verified BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'offline_checksum_only',
  taxpayer_status TEXT NOT NULL DEFAULT 'Unverified',
  legal_name TEXT,
  trade_name TEXT,
  taxpayer_type TEXT NOT NULL DEFAULT 'Unknown',
  inferred_gst_regime TEXT NOT NULL DEFAULT 'regular',
  e_invoice_enabled BOOLEAN,
  registration_date TEXT,
  cancellation_date TEXT,
  risk_level TEXT NOT NULL DEFAULT 'warning',
  risk_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_summary_json JSONB,
  verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cache_expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  detected_state TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  brain_mode TEXT NOT NULL DEFAULT 'neuro_symbolic_deterministic',
  headline TEXT NOT NULL,
  executive_verdict TEXT NOT NULL,
  report_json JSONB NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  hit_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gstn_verifications_ws_gstin ON gstn_verifications(workspace_id, gstin);
CREATE INDEX IF NOT EXISTS idx_agent_runs_ws_created ON agent_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_ws_agent ON agent_runs(workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_bucket_exp ON rate_limit_hits(bucket_key, expires_at);
`,
  },
  {
    version: '0005',
    name: 'connectors_automation_hub',
    sql: `
CREATE TABLE IF NOT EXISTS automation_webhooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'n8n',
  target_url TEXT NOT NULL,
  signing_secret TEXT,
  subscribed_events_json JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_id TEXT REFERENCES automation_webhooks(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'n8n',
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  http_status INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  response_preview TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_webhooks_ws ON automation_webhooks(workspace_id, enabled);
CREATE INDEX IF NOT EXISTS idx_automation_deliveries_ws_created ON automation_deliveries(workspace_id, created_at DESC);
`,
  },
  {
    version: '0006',
    name: 'saas_plans_billing',
    sql: `
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'free_pilot',
  status TEXT NOT NULL DEFAULT 'active',
  monthly_price_inr INTEGER NOT NULL DEFAULT 0,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  current_period_start TIMESTAMP NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`,
  },
  {
    version: '0007',
    name: 'enterprise_lifecycle_frameworks',
    sql: `
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
`,
  },
  {
    version: '0008',
    name: 'integration_health_and_diagnostics',
    sql: `
CREATE TABLE IF NOT EXISTS integration_health (
  id TEXT PRIMARY KEY,
  service_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  last_tested_at TIMESTAMP,
  last_success_at TIMESTAMP,
  last_error TEXT,
  latency_ms INTEGER,
  details_json JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_health_service ON integration_health(service_key);
`,
  },
];

export function splitSqlStatements(sqlBlock: string): string[] {
  return sqlBlock
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}
