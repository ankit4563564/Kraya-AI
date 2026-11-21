-- Migration 0003: Procurement Lifecycle Completeness (GRN Partial Receipts,
-- PO Amendments & Cancellation, Credit/Debit Note Vouchers) & Tamper-Evident Audit Hash Chain.

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
