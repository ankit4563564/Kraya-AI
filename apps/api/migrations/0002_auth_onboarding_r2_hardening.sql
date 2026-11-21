-- Migration 0002: Auth Lifecycle, Company Onboarding, Team Invitations,
-- Cloudflare R2 Persistent File Vault, Webhook Replay Ledger, Unique Constraints & Indexes.

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

-- Backfill memberships for any pre-existing users
INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
SELECT 'mem_' || substr(md5(u.id || u.workspace_id), 1, 12), u.workspace_id, u.id, u.role, u.created_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_memberships m
  WHERE m.workspace_id = u.workspace_id AND m.user_id = u.id
);

-- Unique integrity guards (scoped per workspace)
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_memberships_ws_user ON workspace_memberships(workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfqs_ws_number ON rfqs(workspace_id, rfq_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_ws_number ON purchase_orders(workspace_id, po_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_ws_quote ON purchase_orders(workspace_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_ws_sup_num ON invoices(workspace_id, supplier_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_receipts_provider_ext ON webhook_receipts(provider, external_id);

-- Tenant-scoped performance indexes
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
