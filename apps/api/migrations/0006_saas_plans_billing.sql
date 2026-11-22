-- Migration 0006: Commercial SaaS Plans, Subscription State & Usage Metering

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
