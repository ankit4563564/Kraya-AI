-- Migration 0005: External Connector Hub, n8n Event Bus Webhooks & Delivery Telemetry

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
