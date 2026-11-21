# Kraya — Unified AI Procurement Workspace for Indian SMBs

Prompt-first procurement command center merging the **Accio Agent execution architecture** ([Accio-Agent-Complete-Spec.md](./Accio-Agent-Complete-Spec.md)) with an **Indian CFO-grade deterministic finance & GST 2.0 engine**.

## What Is Built

| Package / App | Purpose |
|---|---|
| `packages/finance-engine` | 100% deterministic integer-paise engine: Offline GSTIN Mod-36 checksum & PAN entity parser, GST 2.0 (post-Sept 2025 5%/18% slabs), Intra/Inter CGST+SGST vs IGST validation, Composition tax-fraud checks, Section 17(5) blocked credits, Rule 42/43 partial ITC (`itcRecoveryPct`), Composite/GTA-RCM freight rules, e-Invoice IRN+QR checks, MSME Section 43B(h) 15d/45d legal credit cap, WACC credit-adjusted landed cost (including advance financing cost), Indian B2B unit normalizer, and PO-vs-Invoice 3-Way Match Money Leak Radar. |
| `packages/agent-core` | Accio 14-Invariant Constitution, Verb Taxonomy, Prompt Injection data fence, progressive-disclosure `SKILL.md` modules, resilient timeout/retry HTTP clients for Google Gemini Flash Vision/PDF, **ElevenLabs Scribe v2** diarized STT & Multilingual Voice Note TTS (`English`, `Hinglish`, `Hindi`, `Kannada`, `Tamil`, `Malayalam`), Groq Whisper V3 Turbo fallback, offline deterministic Hinglish parser, `pdf-lib` GST PO PDF, `exceljs` live-formula `.xlsx` & CA GST IMS Audit Pack, **Tally Prime Purchase XML**, and Official Meta WhatsApp Cloud API + Resend connectors. |
| `apps/api` | Hono TypeScript API with **19-table PostgreSQL Drizzle schema**, version-controlled SQL migrations (`apps/api/migrations/0001_*.sql`, `0002_*.sql`), HTTP-only `SameSite=Lax` cookie sessions with sliding renewal, Forgot/Reset Password, 8-field Indian SMB Company Onboarding, Token-Based Team Invitations (`owner`/`clerk`/`ca`) + Multi-Workspace Switching, **Cloudflare R2 persistent file vault** (Workers `VAULT_BUCKET` binding + WebCrypto AWS SigV4 S3 API + honest local dev disk vault fallback), HMAC signed downloads, sliding-window rate limiting, security headers (CSP, HSTS, nosniff, X-Frame-Options), webhook HMAC + replay deduplication, and DPDP Act 2023 audit logs / export / erasure (including physical file deletion). **Zero dummy data seeded.** |
| `apps/web` | Accio-minimal React + Vite **Installable Mobile PWA**: Full Auth (Sign in, Company Signup with DPDP consent, Forgot/Reset Password, Team Invite Acceptance), 2-step Company Onboarding Wizard with live GSTIN Mod-36 auto-parse, Guided Empty Workspace Launchpad, 5-item sidebar (`+ New Task`, `Unified Inbox`, `Buying & RFQs`, `Maintenance & Daily`, `My Suppliers`), Team & File Vault Settings modal, Multi-Workspace Switcher, CA Read-Only UI affordances, and 3-state Light/Dark/System theme. |

## Quick Start (Runs Locally in 10 Seconds — Zero API Keys Required)

```bash
pnpm install
pnpm test
pnpm dev
```

- **Web App:** `http://localhost:5173`
- **API Server:** `http://localhost:8787/api/health`

Sign up as a new company owner, complete the 2-step GSTIN/WACC onboarding wizard, and start uploading real supplier quotes or purchase invoices immediately (stored locally in `./data/kraya-pg` and `./data/uploads`).

## Deploy to Free Production (Cloudflare Workers + Pages + Neon + R2)

1. **PostgreSQL Database (Neon — Free Tier, Commercial Allowed):**
   - Create a project at [neon.tech](https://neon.tech) and copy the pooled `DATABASE_URL`.
   - Version-controlled SQL migrations (`apps/api/migrations/0001_initial_foundation.sql` and `0002_auth_onboarding_r2_hardening.sql`) apply automatically on first boot and are tracked in `_kraya_migrations` (or can be run manually via `psql "$DATABASE_URL" -f ...`).
2. **Persistent File Vault (Cloudflare R2 — 10 GB Free, ₹0 Egress):**
   - Create bucket: `npx wrangler r2 bucket create kraya-vault`
   - Uncomment `[[r2_buckets]]` (`binding = "VAULT_BUCKET"`) in `apps/api/wrangler.toml`.
   - (For Node.js/Docker hosts instead of Workers, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.)
3. **Backend API (Cloudflare Workers):**
   ```bash
   cd apps/api
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put APP_ORIGIN
   # Optional live AI / Voice / Email / WhatsApp secrets:
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put ELEVENLABS_API_KEY
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put WHATSAPP_ACCESS_TOKEN
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   npx wrangler secret put WHATSAPP_APP_SECRET
   npx wrangler secret put WHATSAPP_VERIFY_TOKEN
   npx wrangler secret put INBOUND_WEBHOOK_SECRET
   npx wrangler deploy
   ```
4. **Frontend PWA (Cloudflare Pages):**
   - Build command: `pnpm --filter @kraya/web build`
   - Output directory: `apps/web/dist`
   - Environment variable: `VITE_API_BASE=https://kraya-api.<your-subdomain>.workers.dev`

> **DPDP Act 2023 / Privacy Reminder:** Switch `GEMINI_API_KEY` to Google AI Studio's Pay-as-you-go tier (zero-training retention) before onboarding paying commercial SMBs.
