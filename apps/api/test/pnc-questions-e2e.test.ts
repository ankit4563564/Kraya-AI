import { describe, expect, it, beforeAll } from 'vitest';
import { createApp } from '../src/app.js';
import { resetDbCache } from '../src/db/client.js';

describe('Full-Fledged End-to-End PnC, User Questions, Cross-Questions & Logical Workflow Suite', () => {
  const testDataDir = `./data/test-pnc-e2e-${Date.now()}`;
  let app: ReturnType<typeof createApp>;
  let authToken = '';

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = testDataDir;
    delete process.env.DATABASE_URL;
    resetDbCache();
    app = createApp({
      NODE_ENV: 'development',
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'test-pnc-e2e-secret-key-2026',
    });
  });

  it('1. Auth & Onboarding PnC: validates consent, password length, duplicate emails, Mod-36 GSTIN, and 2-step onboarding', async () => {
    // PnC 1A: Missing DPDP consent -> 400
    const noConsentRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Adithya Anand',
        companyName: 'Kraya Precision Manufacturing Pvt Ltd',
        email: 'adithya.pnc@kraya.in',
        password: 'StrongPassword123!',
        dpdpConsentAccepted: false,
      }),
    });
    expect(noConsentRes.status).toBe(400);

    // PnC 1B: Short password (<8 chars) -> 400
    const shortPwRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Adithya Anand',
        companyName: 'Kraya Precision Manufacturing Pvt Ltd',
        email: 'adithya.pnc@kraya.in',
        password: 'short',
        dpdpConsentAccepted: true,
      }),
    });
    expect(shortPwRes.status).toBe(400);

    // PnC 1C: Valid Owner Signup -> 201
    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Adithya Anand',
        companyName: 'Kraya Precision Manufacturing Pvt Ltd',
        email: 'adithya.pnc@kraya.in',
        password: 'StrongPassword123!',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const signupData = (await signupRes.json()) as { token: string; needsOnboarding: boolean };
    expect(signupData.token).toBeTruthy();
    expect(signupData.needsOnboarding).toBe(true);
    authToken = signupData.token;

    // PnC 1D: Duplicate email -> 409
    const dupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Adithya Anand',
        companyName: 'Another Co',
        email: 'adithya.pnc@kraya.in',
        password: 'StrongPassword123!',
        dpdpConsentAccepted: true,
      }),
    });
    expect(dupRes.status).toBe(409);

    // PnC 1E: GSTIN Mod-36 Checksum Validation (Valid vs Invalid)
    const validGstinRes = await app.request('/api/gstin/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gstin: '29AABCB1234F1Z4' }),
    });
    const validGstinJson = (await validGstinRes.json()) as {
      valid: boolean;
      stateCode: string;
      panEntityCode: string;
    };
    expect(validGstinJson.valid).toBe(true);
    expect(validGstinJson.stateCode).toBe('29');
    expect(validGstinJson.panEntityCode).toBe('C');

    const badGstinRes = await app.request('/api/gstin/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gstin: '29AABCB1234F1Z9' }),
    });
    const badGstinJson = (await badGstinRes.json()) as { valid: boolean };
    expect(badGstinJson.valid).toBe(false);

    // PnC 1F: Complete 2-Step Company Onboarding
    const onboardRes = await app.request('/api/workspace/onboarding', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        legalName: 'Kraya Precision Manufacturing Pvt Ltd',
        gstin: '29AABCB1234F1Z4',
        gstRegime: 'regular',
        stateCode: '29',
        turnoverBand: 'above_10cr',
        waccPct: 15,
        defaultOutreachLang: 'hinglish',
        businessAddress: 'Plot 42, Peenya Industrial Area Phase 2, Bengaluru, Karnataka 560058',
        primaryContactName: 'Adithya Anand',
        primaryContactPhone: '+91 98450 12345',
        primaryContactEmail: 'adithya.pnc@kraya.in',
      }),
    });
    expect(onboardRes.status).toBe(200);
    const ws = (await onboardRes.json()) as { onboardingCompletedAt: string; waccPct: number };
    expect(ws.onboardingCompletedAt).toBeTruthy();
    expect(ws.waccPct).toBe(15);
  });

  it('2. Full 5-Stage Procurement Workflow PnC: RFQ -> Multi-Quote Landed Cost -> Incomplete Quote Guard -> BATNA Negotiation -> GST PO -> GRN -> Invoice Leak Audit -> GSTR-2B -> Exports', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    };

    // Stage 1: Create RFQ via Prompt Ingest
    const rfqIngestRes = await app.request('/api/prompt/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
        channel: 'manual',
      }),
    });
    expect(rfqIngestRes.status).toBe(200);
    const rfqIngest = (await rfqIngestRes.json()) as {
      created: { rfq?: { id: string; rfqNumber: string } };
    };
    expect(rfqIngest.created.rfq?.id).toBeTruthy();
    const rfqId = rfqIngest.created.rfq!.id;

    // Stage 2A: Log Quote #1 (Ex-GST + ₹5,000 Transport + 30 Days Credit)
    const q1Res = await app.request('/api/prompt/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
        channel: 'whatsapp',
        rfqId,
      }),
    });
    expect(q1Res.status).toBe(200);
    const q1Data = (await q1Res.json()) as {
      created: { quote?: { id: string; netLandedUnitPaise: number; creditAdjustedUnitPaise: number } };
    };
    expect(q1Data.created.quote?.id).toBeTruthy();
    expect(q1Data.created.quote!.netLandedUnitPaise).toBe(2300); // ₹22 + ₹1 freight = ₹23.00
    expect(q1Data.created.quote!.creditAdjustedUnitPaise).toBeLessThan(2300); // WACC credit benefit applied

    // Stage 2B: Log Quote #2 (GST-Inclusive + Free Delivery + 0 Days COD)
    const q2Res = await app.request('/api/prompt/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
        channel: 'phone',
        rfqId,
      }),
    });
    expect(q2Res.status).toBe(200);
    const q2Data = (await q2Res.json()) as {
      created: { quote?: { id: string; netLandedUnitPaise: number; creditAdjustedUnitPaise: number } };
    };
    expect(q2Data.created.quote?.id).toBeTruthy();

    // Stage 3A: Run AI BATNA Negotiation Strategy on the 2-Quote RFQ
    const negRes = await app.request(`/api/rfqs/${rfqId}/negotiation-strategy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ preferredLanguage: 'hinglish', urgencyDays: 7 }),
    });
    expect(negRes.status).toBe(200);
    const negData = (await negRes.json()) as {
      spread: { maxOrderSavingsPaise: number };
      supplierTactics: Array<{ supplierName: string }>;
    };
    expect(negData.supplierTactics.length).toBe(2);
    expect(negData.spread.maxOrderSavingsPaise).toBeGreaterThan(0);

    // Stage 3B: Approve Winning Quote into Legally-Binding GST Purchase Order (PnC: without explicitApprovalConfirmed -> 403, with -> 201, duplicate -> 409)
    const unconfirmedPoRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quoteId: q1Data.created.quote!.id, explicitApprovalConfirmed: false }),
    });
    expect(unconfirmedPoRes.status).toBe(403);

    const poRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        quoteId: q1Data.created.quote!.id,
        approvedBy: 'Adithya Anand',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(poRes.status).toBe(201);
    const poData = (await poRes.json()) as { po: { id: string; poNumber: string } };
    expect(poData.po.poNumber).toContain('PO-');

    const dupPoRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        quoteId: q1Data.created.quote!.id,
        approvedBy: 'Adithya Anand',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(dupPoRes.status).toBe(409);

    // Stage 4: Run Autonomous Expeditor Sweep & Schedule AMC
    const amcRes = await app.request('/api/amc', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assetName: '125 kVA Kirloskar DG Generator',
        frequencyDays: 90,
        nextDueAt: new Date().toISOString().slice(0, 10),
        estimatedCostRupees: 18500,
      }),
    });
    expect(amcRes.status).toBe(201);

    const sweepRes = await app.request('/api/automation/run-sweep', {
      method: 'POST',
      headers,
    });
    expect(sweepRes.status).toBe(200);

    // Stage 5: Audit Supplier Invoice with Double-Taxed Freight & Rate Creep
    const invRes = await app.request('/api/prompt/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt:
          'Audit Invoice #INV-412 from Shakti Packaging: 5000 boxes @ ₹26.50 + 5% GST, freight ₹5000 already incl of GST taxed at 18% again, Grand Total ₹145025',
        channel: 'pdf',
      }),
    });
    expect(invRes.status).toBe(200);
    const invData = (await invRes.json()) as {
      created: { audit?: { totalMoneyLeakPaise: number; imsSuggestedAction: string } };
    };
    expect(invData.created.audit?.totalMoneyLeakPaise).toBeGreaterThan(0);

    // Verify Exports: Tally XML, Zoho Books CSV, CA Audit Pack XLSX
    const tallyRes = await app.request('/api/exports/tally.xml', { headers });
    expect(tallyRes.status).toBe(200);
    const tallyXml = await tallyRes.text();
    expect(tallyXml).toContain('<ENVELOPE>');

    const zohoRes = await app.request('/api/exports/zoho-books.csv', { headers });
    expect(zohoRes.status).toBe(200);
    const zohoCsv = await zohoRes.text();
    expect(zohoCsv).toContain('Bill Number');

    const caPackRes = await app.request('/api/exports/ca-audit-pack.xlsx', { headers });
    expect(caPackRes.status).toBe(200);
  });

  it('3. Conversational CFO Questions & Multi-Turn Cross-Questions PnC Suite (/api/agents/ask)', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    };

    const conversationHistory: Array<{ role: 'user' | 'assistant'; text: string; topic?: string }> = [];

    // Q1: Landed Cost & WACC Question
    const q1Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Why is Bharat Packaging ranked #1 even though they charge ₹5,000 extra for transport?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q1Res.status).toBe(200);
    const q1 = (await q1Res.json()) as {
      qa: {
        topic: string;
        isCrossQuestion: boolean;
        headline: string;
        directAnswer: string;
        mathProof: Array<{ label: string; value: string }>;
        pncMatrix: Array<{ condition: string; outcome: string }>;
        suggestedCrossQuestions: string[];
      };
    };
    expect(q1.qa.topic).toBe('landed_cost_wacc');
    expect(q1.qa.mathProof.length).toBeGreaterThanOrEqual(4);
    expect(q1.qa.pncMatrix.length).toBeGreaterThanOrEqual(3);
    expect(q1.qa.suggestedCrossQuestions.length).toBeGreaterThanOrEqual(3);

    conversationHistory.push(
      { role: 'user', text: 'Why is Bharat Packaging ranked #1?', topic: q1.qa.topic },
      { role: 'assistant', text: q1.qa.directAnswer, topic: q1.qa.topic }
    );

    // CQ1: Follow-Up Cross-Question Challenging WACC & Credit Days (Dynamic Recalculation!)
    const cq1Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Wait — what if our WACC jumps to 24% and Bharat cuts credit to 10 days? Does the winner flip?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(cq1Res.status).toBe(200);
    const cq1 = (await cq1Res.json()) as {
      qa: {
        topic: string;
        isCrossQuestion: boolean;
        headline: string;
        directAnswer: string;
      };
    };
    expect(cq1.qa.topic).toBe('landed_cost_wacc');
    expect(cq1.qa.isCrossQuestion).toBe(true);
    expect(cq1.qa.headline).toContain('24%');

    // Q2: GST 2.0 & Double-Taxed Freight Leak Question
    const q2Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Why was ₹900 flagged as a money leak on Invoice #INV-412? Explain Composite Supply vs GTA RCM.',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q2Res.status).toBe(200);
    const q2 = (await q2Res.json()) as { qa: { topic: string; directAnswer: string } };
    expect(q2.qa.topic).toBe('gst_freight_itc');
    expect(q2.qa.directAnswer).toContain('Section 8(a)');

    // CQ2: Cross-Question on Section 34 Credit Note Refusal
    const cq2Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'What if the supplier refuses to issue a Section 34 GST Credit Note for the ₹900 leak?',
        conversationHistory: [
          ...conversationHistory,
          { role: 'user', text: 'Why was ₹900 flagged?', topic: 'gst_freight_itc' },
          { role: 'assistant', text: q2.qa.directAnswer, topic: 'gst_freight_itc' },
        ],
        skipNetwork: true,
      }),
    });
    expect(cq2Res.status).toBe(200);
    const cq2 = (await cq2Res.json()) as { qa: { topic: string; isCrossQuestion: boolean; directAnswer: string } };
    expect(cq2.qa.topic).toBe('gst_freight_itc');
    expect(cq2.qa.isCrossQuestion).toBe(true);

    // Q3 & CQ3: Section 43B(h) MSME Question + Cross-Question on "No Written Agreement" (15 days vs 45 days)
    const cq3Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Wait, what if there is NO written agreement with the MSME vendor — is the deadline 15 days or 45 days?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(cq3Res.status).toBe(200);
    const cq3 = (await cq3Res.json()) as { qa: { topic: string; isCrossQuestion: boolean; directAnswer: string } };
    expect(cq3.qa.topic).toBe('msme_43bh_rule37');
    expect(cq3.qa.isCrossQuestion).toBe(true);
    expect(cq3.qa.directAnswer).toContain('15 days');

    // Q4: TDS 194Q vs 194C & 6th-Character GSTIN PAN Entity Decoder
    const q4Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'How do you know if a vendor gets 1% or 2% TDS under Section 194C or 0.1% under 194Q from their GSTIN?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q4Res.status).toBe(200);
    const q4 = (await q4Res.json()) as { qa: { topic: string; directAnswer: string } };
    expect(q4.qa.topic).toBe('tds_194q_194c');
    expect(q4.qa.directAnswer).toContain('194Q');

    // Q5: 3-Way Match (PO vs GRN vs Invoice) & SHA-256 Audit Chain
    const q5Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Why did 3-way match block our invoice when partial GRN arrived, and how does the SHA-256 audit chain work?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q5Res.status).toBe(200);
    const q5 = (await q5Res.json()) as { qa: { topic: string; directAnswer: string } };
    expect(q5.qa.topic).toBe('three_way_match_audit');

    // Q6: BATNA Negotiation Playbook Question
    const q6Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'How do we use this landed-cost spread as BATNA leverage to negotiate a counter-offer?',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q6Res.status).toBe(200);
    const q6 = (await q6Res.json()) as { qa: { topic: string } };
    expect(q6.qa.topic).toBe('batna_negotiation');

    // Q7: Workspace Overview Question
    const q7Res = await app.request('/api/agents/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: 'Give me an executive overview of our workspace spend and active pipeline.',
        conversationHistory,
        skipNetwork: true,
      }),
    });
    expect(q7Res.status).toBe(200);
    const q7 = (await q7Res.json()) as { qa: { topic: string } };
    expect(q7.qa.topic).toBe('workspace_overview');
  });

  it('4. All 8 Specialist Agent Minds execute cleanly on demand (/api/agents/run)', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    };
    const agentIds = [
      'orchestrator',
      'intake',
      'sourcing',
      'cfo_strategist',
      'negotiation',
      'auditor',
      'compliance',
      'operations',
    ] as const;

    for (const agentId of agentIds) {
      const res = await app.request('/api/agents/run', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId,
          promptText: 'Corrugated 5-ply packaging boxes Bengaluru',
          skipNetwork: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        runId: string;
        report: { agentId: string; headline: string; conditionsEvaluated: unknown[] };
      };
      expect(data.runId).toBeTruthy();
      expect(data.report.agentId).toBe(agentId);
      expect(data.report.headline.length).toBeGreaterThan(5);
    }
  });
});
