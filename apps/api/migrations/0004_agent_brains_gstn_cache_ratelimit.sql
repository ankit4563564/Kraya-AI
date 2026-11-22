-- Migration 0004: Specialist Agent Run History, 30-Day Live GSTN Verification Cache & Distributed Rate Limit Buckets

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
