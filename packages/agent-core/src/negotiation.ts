import { formatINR, Paise } from '@kraya/finance-engine';
import { formatIndianPhoneForWa } from './outreach.js';

export interface NegotiationQuoteInput {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  baseUnitPaise: Paise;
  netLandedUnitPaise: Paise;
  creditAdjustedUnitPaise: Paise;
  creditDays: number;
  leadTimeDays?: number | null;
  reliabilityScore?: number | null;
  quantity: number;
  unit: string;
}

export interface SupplierNegotiationTactic {
  supplierId: string;
  supplierName: string;
  currentRatePaise: Paise;
  currentLandedPaise: Paise;
  targetCounterRatePaise: Paise;
  potentialSavingsPaise: Paise;
  leveragePoints: string[];
  recommendedTactics: string[];
  riskAssessment: string;
  counterOfferMessages: {
    hinglish: string;
    english: string;
    hindi: string;
  };
  whatsAppBridgeUrl: string;
  emailBridgeUrl: string;
}

export interface RfqNegotiationAnalysis {
  rfqTitle: string;
  quantity: number;
  unit: string;
  quoteCount: number;
  spread: {
    lowestLandedPaise: Paise;
    highestLandedPaise: Paise;
    spreadPaise: Paise;
    spreadPct: number;
    maxOrderSavingsPaise: Paise;
  };
  batna: {
    supplierName: string;
    ratePaise: Paise;
    effectiveRatePaise: Paise;
    creditDays: number;
    keyAdvantage: string;
  };
  supplierTactics: SupplierNegotiationTactic[];
  strategicAdvice: string;
}

/**
 * AI Procurement Negotiation Engine for Indian Manufacturing SMBs.
 * Uses game-theoretic BATNA analysis and real Indian factory trade-offs (Volume breaks,
 * Cash Discount 2%, Section 43B(h) credit terms, Freight absorption) to formulate
 * relationship-preserving counter-offers.
 */
export function buildNegotiationStrategy(
  rfqTitle: string,
  buyerCompany: string,
  quotes: NegotiationQuoteInput[]
): RfqNegotiationAnalysis {
  if (quotes.length === 0) {
    throw new Error('Negotiation analysis requires at least 1 quote.');
  }

  const sortedByEffective = [...quotes].sort(
    (a, b) => a.creditAdjustedUnitPaise - b.creditAdjustedUnitPaise
  );
  const bestQuote = sortedByEffective[0];
  const worstQuote = sortedByEffective[sortedByEffective.length - 1];

  const lowestLanded = bestQuote.creditAdjustedUnitPaise;
  const highestLanded = worstQuote.creditAdjustedUnitPaise;
  const spreadPaise = Math.max(0, highestLanded - lowestLanded);
  const spreadPct = lowestLanded > 0 ? Math.round((spreadPaise / lowestLanded) * 1000) / 10 : 0;
  const quantity = bestQuote.quantity || 1000;
  const unit = bestQuote.unit || 'units';
  const maxOrderSavingsPaise = spreadPaise * quantity;

  const batna = {
    supplierName: bestQuote.supplierName,
    ratePaise: bestQuote.baseUnitPaise,
    effectiveRatePaise: bestQuote.creditAdjustedUnitPaise,
    creditDays: bestQuote.creditDays,
    keyAdvantage:
      bestQuote.creditDays > 30
        ? `Lowest credit-adjusted cost with generous Net ${bestQuote.creditDays}d terms`
        : `Aggressive base unit pricing of ${formatINR(bestQuote.baseUnitPaise)}/${unit}`,
  };

  const supplierTactics: SupplierNegotiationTactic[] = sortedByEffective.map((q, idx) => {
    const isBest = idx === 0;
    const rateDiffPaise = q.creditAdjustedUnitPaise - lowestLanded;

    // Determine realistic target rate:
    // If it is already the best quote, target another 2-3% volume discount.
    // If it's a higher quote, target matching the BATNA minus a small concession.
    let targetCounterRatePaise: Paise;
    if (isBest) {
      targetCounterRatePaise = Math.round(q.baseUnitPaise * 0.97);
    } else {
      // Aim for halfway between best base rate and current rate
      targetCounterRatePaise = Math.min(q.baseUnitPaise, Math.round((q.baseUnitPaise + bestQuote.baseUnitPaise) / 2));
    }

    const potentialSavingsPaise = Math.max(0, (q.baseUnitPaise - targetCounterRatePaise) * quantity);

    const leveragePoints: string[] = [];
    const recommendedTactics: string[] = [];

    if (isBest) {
      leveragePoints.push('Preferred vendor with lowest landed cost benchmark');
      leveragePoints.push(`Immediate PO release for ${quantity.toLocaleString('en-IN')} ${unit}`);
      recommendedTactics.push('Offer prompt single-tranche PO release in exchange for 2-3% bulk concession');
      recommendedTactics.push('Guarantee repeat monthly order schedule if pricing is locked for 60 days');
    } else {
      leveragePoints.push(`Competing verified benchmark available at ${formatINR(bestQuote.baseUnitPaise)}/${unit}`);
      if (q.creditDays < bestQuote.creditDays) {
        leveragePoints.push(`Competitor offers Net ${bestQuote.creditDays}d credit vs your Net ${q.creditDays}d`);
      }
      recommendedTactics.push(`Cite competing quote of ${formatINR(bestQuote.baseUnitPaise)} and ask for price match`);
      recommendedTactics.push('Offer 7-day payment turnaround (2% Cash Discount) if rate is reduced');
      recommendedTactics.push('Ask for freight absorption (FOR destination delivery) to bridge the landed gap');
    }

    // Risk Assessment
    let riskAssessment = 'Low risk. Standard market negotiation.';
    if ((q.reliabilityScore ?? 100) < 80) {
      riskAssessment = 'Caution: Historical delivery delays logged. Do not compromise on lead-time penalty clause.';
    } else if (spreadPct > 20 && !isBest) {
      riskAssessment = 'High spread: Supplier may be quoting premium material or broker margins. Verify raw specs.';
    }

    // Multi-Language Counter-Offer Drafting
    const quotedFormatted = formatINR(q.baseUnitPaise);
    const targetFormatted = formatINR(targetCounterRatePaise);

    const hinglishMsg = isBest
      ? `Namaste ${q.supplierName} ji,\n\n${rfqTitle} ke quote (${quotedFormatted}/${unit}) ke liye dhanyavaad. Hum aapko prefer kar rahe hain aur turant ${quantity.toLocaleString('en-IN')} ${unit} ka PO release karna chahte hain.\n\nAgar aap is regular volume par special rate ${targetFormatted}/${unit} de sakein, toh hum aaj hi formal PO issue kar denge.\n\nRegards,\n${buyerCompany}`
      : `Namaste ${q.supplierName} ji,\n\n${rfqTitle} ke quote ke liye dhanyavaad. Aapka rate (${quotedFormatted}/${unit}) hamare current market benchmark se thoda uncha hai (humein ${formatINR(bestQuote.baseUnitPaise)} ka quote mila hai).\n\nHum aapke saath regular kaam karna chahte hain. Agar aap ${targetFormatted}/${unit}${q.creditDays >= 30 ? ` with Net ${q.creditDays}d terms` : ''} match kar sakein, toh hum PO aapko denge.\n\nRegards,\n${buyerCompany}`;

    const englishMsg = isBest
      ? `Dear ${q.supplierName},\n\nThank you for quoting on ${rfqTitle} at ${quotedFormatted}/${unit}. You are currently our preferred vendor for this requirement of ${quantity.toLocaleString('en-IN')} ${unit}.\n\nIf you can extend a special volume rate of ${targetFormatted}/${unit}, we are ready to issue the formal Purchase Order today.\n\nBest regards,\n${buyerCompany}`
      : `Dear ${q.supplierName},\n\nThank you for quoting on ${rfqTitle}. Your quote of ${quotedFormatted}/${unit} is currently above our verified alternative benchmark of ${formatINR(bestQuote.baseUnitPaise)}/${unit}.\n\nWe value our relationship and would prefer awarding this order to you. Could you consider matching ${targetFormatted}/${unit} on your standard terms?\n\nBest regards,\n${buyerCompany}`;

    const hindiMsg = isBest
      ? `नमस्ते ${q.supplierName} जी,\n\n${rfqTitle} के कोटेशन (${quotedFormatted}/${unit}) के लिए धन्यवाद। हम इस ${quantity.toLocaleString('en-IN')} ${unit} के ऑर्डर के लिए आपको प्राथमिकता दे रहे हैं।\n\nयदि आप इस नियमित मात्रा पर विशेष दर ${targetFormatted}/${unit} स्वीकृत कर सकें, तो हम आज ही PO जारी करने के लिए तैयार हैं।\n\nधन्यवाद,\n${buyerCompany}`
      : `नमस्ते ${q.supplierName} जी,\n\n${rfqTitle} के कोटेशन के लिए धन्यवाद। आपकी दर (${quotedFormatted}/${unit}) हमारे मौजूदा बेंचमार्क (${formatINR(bestQuote.baseUnitPaise)}) से अधिक है।\n\nयदि आप ${targetFormatted}/${unit} पर सहमति दे सकें, तो हम यह ऑर्डर आपको देने के इच्छुक हैं।\n\nधन्यवाद,\n${buyerCompany}`;

    // Generate Outreach URLs
    const phone = formatIndianPhoneForWa(q.supplierPhone);
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(hinglishMsg)}`
      : `https://wa.me/?text=${encodeURIComponent(hinglishMsg)}`;

    const mailtoSubject = encodeURIComponent(`Rate Revision Request: ${rfqTitle} — ${buyerCompany}`);
    const mailtoBody = encodeURIComponent(englishMsg);
    const emailBridgeUrl = q.supplierEmail
      ? `mailto:${q.supplierEmail}?subject=${mailtoSubject}&body=${mailtoBody}`
      : '';

    return {
      supplierId: q.supplierId,
      supplierName: q.supplierName,
      currentRatePaise: q.baseUnitPaise,
      currentLandedPaise: q.creditAdjustedUnitPaise,
      targetCounterRatePaise,
      potentialSavingsPaise,
      leveragePoints,
      recommendedTactics,
      riskAssessment,
      counterOfferMessages: {
        hinglish: hinglishMsg,
        english: englishMsg,
        hindi: hindiMsg,
      },
      whatsAppBridgeUrl: waUrl,
      emailBridgeUrl,
    };
  });

  const strategicAdvice =
    spreadPct > 15
      ? `High quote variance of ${spreadPct}% detected across suppliers. Use ${batna.supplierName}'s effective rate of ${formatINR(batna.effectiveRatePaise)}/${unit} as a hard anchor to negotiate counter-offers. Potential savings: ${formatINR(maxOrderSavingsPaise)} on this batch.`
      : `Tight quote spread of ${spreadPct}%. Pricing is competitive. Focus negotiation on Net 45-day credit terms, freight absorption (FOR destination), or guaranteed delivery lead times rather than deep unit rate cuts.`;

  return {
    rfqTitle,
    quantity,
    unit,
    quoteCount: quotes.length,
    spread: {
      lowestLandedPaise: lowestLanded,
      highestLandedPaise: highestLanded,
      spreadPaise,
      spreadPct,
      maxOrderSavingsPaise,
    },
    batna,
    supplierTactics,
    strategicAdvice,
  };
}
