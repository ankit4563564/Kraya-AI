---
name: gst-po-generator
description: Generate a legally compliant Indian GST Purchase Order PDF from an approved supplier quote with buyer/vendor GSTIN, HSN codes, auto CGST+SGST or IGST split, and explicit written Net Credit Days (protecting the 45-day Section 43B(h) window). Use ONLY after explicit owner approval of a quote. Do NOT auto-issue on read/compare prompts.
---

# GST Purchase Order Generator Skill

## Procedure
1. Verify explicit human approval gate (`approved_by` + exact recipient + exact total).
2. Compute all line totals and Intra/Inter-state GST split deterministically via `computeGstLine`.
3. Explicitly print written payment terms (e.g., `Net 30 Days` or `Net 45 Days`) to safeguard MSME Section 43B(h) compliance.
4. Emit deterministic PDF via `generateGstPoPdf` (`pdf-lib`).
5. Create automatic delivery chase task in `daily_tasks` for `delivery_due_at`.
6. Offer 1-click `wa.me` / `mailto:` outreach bridge — never send silently.
