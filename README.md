# Kraya — Unified AI Procurement Workspace for Indian SMBs

Prompt-first procurement command center merging the **Accio Agent execution architecture** ([Accio-Agent-Complete-Spec.md](./Accio-Agent-Complete-Spec.md)) with an **8-Agent Specialist Brain Fleet**, an **Indian CFO-grade deterministic GST 2.0 & finance engine**, and a **Bi-Directional n8n & External Connector Hub**.

## What Is Built (All Phases Complete)

| Package / App | Purpose |
|---|---|
| `packages/finance-engine` | 100% deterministic integer-paise engine: Offline GSTIN Mod-36 checksum & PAN entity parser, GST 2.0 (`0%/5%/18%/40%` date-aware slabs), Intra/Inter CGST+SGST vs IGST validation, Composition tax-fraud checks, Section 17(5) blocked credits, Rule 42/43 partial ITC, Composite/GTA-RCM freight rules, e-Invoice IRN+QR checks, MSME Section 43B(h) 15d/45d legal credit cap, WACC credit-adjusted landed cost, Indian B2B unit normalizer, PO-vs-GRN-vs-Invoice 3-Way Match Money Leak Radar, and GSTR-2B/IMS Reconciler. |
| `packages/agent-core` | **8-Agent Specialist Brain Fleet** (`Orchestrator`, `Intake Forensics`, `Real-Time Sourcing`, `CFO Strategist`, `Game-Theoretic Negotiation`, `PO/GRN 3-Way Auditor`, `GST Compliance Tax Shield`, `Autonomous Operations`), Accio 14-Invariant Constitution, live Indian FY/GST/FX real-time context engine, Gemini 2.5 Flash Vision + Google Search Grounding, Live GSTN & Udyam verifiers, Google Places / Serper / Tavily B2B directory connectors, Zoho Books India & Tally Prime HTTP push connectors, Razorpay free IFSC + RazorpayX payout drafts, **n8n HMAC-SHA256 Event Bus + 4 ready-to-import workflow JSONs**, VoiceStudio / ElevenLabs Scribe & Multilingual TTS (6 Indian languages), Groq Whisper fallback, `pdf-lib` GST PO PDF, `exceljs` live-formula `.xlsx` & CA Audit Pack, and Tally XML / Zoho CSV exports. |
| `apps/api` | Hono TypeScript API (Node 22 + Cloudflare Workers) with **25-table PostgreSQL Drizzle schema** and version-controlled SQL migrations (`0001`–`0006`), HTTP-only cookie sessions, RBAC (`owner`/`clerk`/`ca`), multi-workspace switching, Cloudflare R2 persistent vault + local dev disk fallback, SHA-256 tamper-evident audit chain, distributed KV/Postgres rate limiting, **8:00 AM IST Cloudflare Morning Cron (`scheduled()`)**, inbound WhatsApp / Call / Email (with PDF/Image attachment ingestion) webhooks, Razorpay SaaS billing & usage metering, and DPDP Act 2023 export/erasure. **Zero dummy data seeded.** |
| `apps/web` | Installable React 19 + Vite PWA: Full Auth + 2-Step GSTIN/WACC Onboarding, 5-item workspace (`Studio`, `Unified Inbox`, `Buying & RFQs`, `Daily & Audit`, `Suppliers`), **AI Engines Fleet Inspector**, **APIs & n8n Connector Hub**, 1-click Live GSTN Verify, GSTR-2B Reconciler, Bulk BOM Import, Negotiation Coach, Voice Cloning, and Plans / Usage / DPDP Legal Shield modal. |
| `workers/email-ingress-worker` & `automations/n8n` | Standalone zero-cost **Cloudflare Email Routing Ingress Worker** (`rfq@yourdomain.in` → Kraya PDF webhook) + 4 ready-to-import n8n workflow blueprints. |
| `.github/workflows/ci-cd.yml` | Automated GitHub Actions CI/CD for build, typecheck, testing & Cloudflare deployment. |

## Quick Start (Local — Zero Setup & Zero External Dependencies Required)

Kraya runs natively with zero external dependencies. The local database uses embedded **PGlite** (in-process WebAssembly PostgreSQL), so no external database or container installation is required:

```bash
pnpm install
pnpm build
pnpm dev
```

- **Web App:** `http://localhost:5173`
- **API Server:** `http://localhost:8787/api/health`

## Production Deployment (Serverless / Native Node.js)

### Option A: Free Commercial Cloud Deploy (Cloudflare Workers + Pages + Neon + R2)

1. **Neon Postgres:** Create free project at [neon.tech](https://neon.tech) → copy pooled `DATABASE_URL` (migrations `0001`–`0006` auto-apply on boot).
2. **Cloudflare R2:** `npx wrangler r2 bucket create kraya-vault` and uncomment `[[r2_buckets]]` in `apps/api/wrangler.toml`.
3. **Secrets & Deploy:** Set secrets via `wrangler secret put` (see `apps/api/wrangler.toml` & `.env.example`) and run `./scripts/deploy-free.sh` (includes the daily 8:00 AM IST Morning Cron trigger).
4. **Inbound Email Worker (Optional ₹0):** `cd workers/email-ingress-worker && npx wrangler deploy`.

### Option B: Self-Hosted Node.js Server

```bash
# 1. Build workspace
pnpm install && pnpm build

# 2. Run API server
export DATABASE_URL="postgres://..." # Or leave blank for local embedded PGlite
export PORT=8787
node apps/api/dist/node-server.js

# 3. Serve Web App
# Serve apps/web/dist using any static file server (Nginx, Caddy, Vercel, Netlify)
```
