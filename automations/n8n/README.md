# Kraya — n8n End-to-End Automation Blueprints

Instead of hand-coding brittle third-party glue for Gmail, Outlook, Slack, Telegram, Google Sheets, Tally Prime, or Zoho Books, Kraya exposes a **Bi-Directional Signed Event Bus**:

1. **Download any workflow JSON directly from Kraya UI** (`n8n & APIs` button in the top bar) or via `GET /api/connectors/n8n-templates/:slug`:
   - `gmail-pdf-to-kraya` — Gmail/Outlook vendor PDF quotes & bills → `POST /api/webhooks/email-inbound`
   - `money-leak-escalation-alerts` — Kraya `invoice.leak_detected` / `msme.43bh_cliff` → Slack / WhatsApp / Google Sheets
   - `zoho-tally-erp-auto-sync` — Kraya `invoice.clean_ready_to_pay` → Zoho Books India API / Tally Prime → `POST /api/connectors/n8n/callback`
   - `morning-8am-cfo-briefing` — Daily 8:00 AM IST trigger → `POST /api/internal/cron/morning-sweep` → Owner Email/WhatsApp CFO Digest
2. **Import into n8n** (n8n Cloud or Self-Hosted Docker) via **Workflows → Import from File**.
3. **Register your n8n Webhook URL** in Kraya's **n8n & APIs** modal (or set `N8N_DEFAULT_WEBHOOK_URL` + `N8N_WEBHOOK_SECRET` in Cloudflare Workers secrets).
4. **Verify signatures** in n8n using `X-Kraya-Signature-256` (`HMAC-SHA256(secret, timestamp + "." + rawBody)`).
