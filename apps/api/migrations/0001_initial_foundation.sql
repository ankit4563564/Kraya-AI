-- Migration 0001: Initial Kraya Procurement Foundation Schema
-- Uses 64-bit BIGINT for all integer paise columns (safe above ₹2.14 Cr up to ₹90 Lakh Crore).

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
