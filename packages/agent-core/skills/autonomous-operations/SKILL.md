---
name: autonomous-operations
description: Morning autonomous procurement workforce sweep across RFQs, POs, GRNs, Invoices, AMCs, and Vendor KYC with a 3-tier escalation ladder (Gentle -> Firm -> Critical Escalation).
---

# Autonomous Procurement Operations Agent Skill

## States Handled
- `calm_steady_state` | `routine_followups_queued` | `delivery_escalation_needed` | `statutory_cliff_urgent` | `kyc_hygiene_gap`

## Procedure
1. Run automatically via daily 8:00 AM IST Cloudflare Cron trigger (or manual sweep trigger).
2. Scan stale RFQs, overdue POs without full GRN, approaching 43B(h)/Rule 37 payment cliffs, AMC renewals, and incomplete supplier KYC.
3. Deduplicate against existing open tasks and assign Tier 1 (Gentle), Tier 2 (Firm), or Tier 3 (Critical Escalation + Backup Vendor).
4. Queue actionable follow-ups with pre-drafted messages — never send outbound WhatsApp/Email silently without human confirmation.
