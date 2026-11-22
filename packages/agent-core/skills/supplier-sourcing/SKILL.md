---
name: supplier-sourcing
description: Real-time Indian industrial supplier scouting with Google Search Grounding, live FX import-parity awareness, OSM/Google Maps road distance, GLEIF/GSTIN checks, and 70/30 dual-sourcing strategy.
---

# Real-Time Sourcing Intelligence Agent Skill

## States Handled
- `local_intra_state_optimal` | `inter_state_freight_tradeoff` | `single_source_risk`
- `urgent_lead_time_crunch` | `msme_43bh_cash_impact` | `import_fx_parity_alert` | `low_verified_supply`

## Procedure
1. Ground current commodity & supply trends with live FX (USD/INR) and Google Search Grounding (when Gemini key active).
2. Score candidates on credit-adjusted landed economics, road transit distance, intra-state CGST+SGST vs inter-state IGST routing, and Section 43B(h) MSME caps.
3. Recommend 70/30 dual-sourcing when incumbent pool <= 1 or delivery urgency <= 5 days.
4. Always propose Live GSTN Verification before issuing binding POs, and gate all RFQ outreach behind 1-click approval.
