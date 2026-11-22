import { formatINR, validateGstin } from '@kraya/finance-engine';

export interface SweepRfqInput {
  id: string;
  rfqNumber: string;
  title: string;
  status: string;
  quoteCount: number;
  createdAt: Date | string;
}

export interface SweepPoInput {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  deliveryDueAt: string;
  invoiceStatus: string;
  cancelledAt: Date | string | null;
  hasFullGrn: boolean;
}

export interface SweepInvoiceInput {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  grandTotalPaise: number;
  msme43bhDueAt: string | null;
  rule37CliffAt: string | null;
  paidAt: Date | string | null;
}

export interface SweepAmcInput {
  id: string;
  assetName: string;
  supplierId: string | null;
  supplierName: string | null;
  nextDueAt: string;
  status: string;
}

export interface SweepSupplierInput {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  gstRegime: string;
  udyamTier: string;
  creditDays: number;
}

export interface ExistingOpenTaskKey {
  kind: string;
  relatedId: string | null;
}

export interface PlannedFollowupTask {
  kind: 'rfq_chase' | 'delivery_chase' | 'payment_43bh' | 'rule37_itc_cliff' | 'amc_renewal' | 'vendor_kyc_chase';
  priority: 'high' | 'medium' | 'low';
  title: string;
  supplierId: string | null;
  relatedId: string;
  dueAt: string;
  suggestedMessage: string;
}

export interface SupplierKycScore {
  supplierId: string;
  name: string;
  scorePct: number;
  missingFields: string[];
  whatsappKycUrl: string;
  kycChaseMessage: string;
}

export interface AutonomousSweepPlan {
  plannedTasks: PlannedFollowupTask[];
  kycScores: SupplierKycScore[];
  summary: {
    staleRfqsFound: number;
    overdueDeliveriesFound: number;
    msmeCliffsFound: number;
    rule37CliffsFound: number;
    amcsDueFound: number;
    incompleteKycSuppliers: number;
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.ceil((b - a) / 86400000);
}

/**
 * Deterministic Autonomous Procurement Workforce Sweep.
 * Replaces manual morning checks by Purchase Expeditors, KYC Officers, and AP Clerks.
 */
export function planAutonomousProcurementSweep(input: {
  todayIso: string;
  rfqs: SweepRfqInput[];
  pos: SweepPoInput[];
  invoices: SweepInvoiceInput[];
  amcs: SweepAmcInput[];
  suppliers: SweepSupplierInput[];
  existingOpenTasks: ExistingOpenTaskKey[];
}): AutonomousSweepPlan {
  const existingSet = new Set(
    input.existingOpenTasks.map((t) => `${t.kind}::${t.relatedId || ''}`)
  );
  const plannedTasks: PlannedFollowupTask[] = [];

  let staleRfqsFound = 0;
  let overdueDeliveriesFound = 0;
  let msmeCliffsFound = 0;
  let rule37CliffsFound = 0;
  let amcsDueFound = 0;

  const pushIfNew = (task: PlannedFollowupTask) => {
    const key = `${task.kind}::${task.relatedId}`;
    if (!existingSet.has(key)) {
      existingSet.add(key);
      plannedTasks.push(task);
    }
  };

  // 1. Stale RFQs (open with < 2 quotes and >= 1 day old)
  const todayMs = new Date(`${input.todayIso}T23:59:59Z`).getTime();
  for (const rfq of input.rfqs) {
    if (rfq.status !== 'open' || rfq.quoteCount >= 2) continue;
    const ageHours = (todayMs - new Date(rfq.createdAt).getTime()) / 3600000;
    if (ageHours >= 20) {
      staleRfqsFound++;
      pushIfNew({
        kind: 'rfq_chase',
        priority: 'medium',
        title: `Chase vendor quotes for ${rfq.rfqNumber}: ${rfq.title} (${rfq.quoteCount} quote${rfq.quoteCount === 1 ? '' : 's'} received)`,
        supplierId: null,
        relatedId: rfq.id,
        dueAt: input.todayIso,
        suggestedMessage: `Namaste, reminder regarding RFQ ${rfq.rfqNumber} (${rfq.title}). Kripya apna best rate, GST%, freight aur Net credit terms aaj share kijiye taaki PO finalize ho sake.`,
      });
    }
  }

  // 2. Overdue PO Deliveries (Expeditor role)
  for (const po of input.pos) {
    if (po.cancelledAt || po.hasFullGrn || po.invoiceStatus === 'matched') continue;
    const daysLeft = daysBetween(input.todayIso, po.deliveryDueAt);
    if (daysLeft <= 0) {
      overdueDeliveriesFound++;
      const overdueDays = Math.abs(daysLeft);
      pushIfNew({
        kind: 'delivery_chase',
        priority: 'high',
        title: `Overdue Delivery (${overdueDays}d late): ${po.poNumber} from ${po.supplierName}`,
        supplierId: po.supplierId,
        relatedId: po.id,
        dueAt: input.todayIso,
        suggestedMessage: `Namaste ${po.supplierName} ji, hamara PO ${po.poNumber} delivery due date (${po.deliveryDueAt}) cross kar chuka hai. Kripya dispatch status aur LR/vehicle number turant share kijiye.`,
      });
    }
  }

  // 3. MSME Section 43B(h) Payment Cliffs (<= 7 days) & Rule 37 (<= 30 days)
  for (const inv of input.invoices) {
    if (inv.paidAt) continue;
    if (inv.msme43bhDueAt) {
      const daysLeft = daysBetween(input.todayIso, inv.msme43bhDueAt);
      if (daysLeft <= 7) {
        msmeCliffsFound++;
        pushIfNew({
          kind: 'payment_43bh',
          priority: 'high',
          title: `MSME 43B(h) Cliff (${daysLeft <= 0 ? 'OVERDUE' : `${daysLeft}d left`}): ${inv.invoiceNumber} — ${inv.supplierName} (${formatINR(inv.grandTotalPaise)})`,
          supplierId: inv.supplierId,
          relatedId: inv.id,
          dueAt: inv.msme43bhDueAt,
          suggestedMessage: `Internal Finance Alert: Release payment of ${formatINR(inv.grandTotalPaise)} for MSME invoice ${inv.invoiceNumber} (${inv.supplierName}) before ${inv.msme43bhDueAt} to prevent Section 43B(h) tax disallowance.`,
        });
      }
    }
    if (inv.rule37CliffAt) {
      const r37Days = daysBetween(input.todayIso, inv.rule37CliffAt);
      if (r37Days <= 30) {
        rule37CliffsFound++;
        pushIfNew({
          kind: 'rule37_itc_cliff',
          priority: r37Days <= 10 ? 'high' : 'medium',
          title: `GST Rule 37 (180-Day ITC Reversal) in ${r37Days}d: ${inv.invoiceNumber} — ${inv.supplierName}`,
          supplierId: inv.supplierId,
          relatedId: inv.id,
          dueAt: inv.rule37CliffAt,
          suggestedMessage: `Internal GST Alert: Settle invoice ${inv.invoiceNumber} (${inv.supplierName}) before ${inv.rule37CliffAt} to avoid 180-day ITC reversal + 18% interest under CGST Rule 37.`,
        });
      }
    }
  }

  // 4. Upcoming AMC & Spares Maintenance Renewals (<= 7 days)
  for (const amc of input.amcs) {
    if (amc.status !== 'active') continue;
    const daysLeft = daysBetween(input.todayIso, amc.nextDueAt);
    if (daysLeft <= 7) {
      amcsDueFound++;
      pushIfNew({
        kind: 'amc_renewal',
        priority: daysLeft <= 2 ? 'high' : 'medium',
        title: `AMC / Maintenance Due (${daysLeft <= 0 ? 'TODAY' : `in ${daysLeft}d`}): ${amc.assetName}`,
        supplierId: amc.supplierId,
        relatedId: amc.id,
        dueAt: amc.nextDueAt,
        suggestedMessage: `Namaste ${amc.supplierName || 'Team'}, ${amc.assetName} ka scheduled maintenance/AMC (${amc.nextDueAt}) due hai. Kripya technician visit slot aur quote confirm kijiye.`,
      });
    }
  }

  // 5. Vendor KYC & Compliance Completeness Scorer (Vendor Onboarding Officer role)
  const kycScores: SupplierKycScore[] = [];
  let incompleteKycSuppliers = 0;

  for (const sup of input.suppliers) {
    const missing: string[] = [];
    let points = 0;
    const totalPoints = 5;

    if (sup.gstRegime === 'unregistered') {
      points += 1;
    } else if (sup.gstin && validateGstin(sup.gstin).valid) {
      points += 1;
    } else {
      missing.push('Valid 15-char GSTIN');
    }

    if (sup.phone && sup.phone.replace(/\D/g, '').length >= 10) {
      points += 1;
    } else {
      missing.push('WhatsApp / Mobile Number');
    }

    if (sup.email && sup.email.includes('@')) {
      points += 1;
    } else {
      missing.push('Official Billing Email');
    }

    if (sup.udyamTier && sup.udyamTier !== 'unknown') {
      points += 1;
    } else {
      missing.push('MSME Udyam Certificate / Declaration (for Sec 43B(h))');
    }

    if (typeof sup.creditDays === 'number' && sup.creditDays >= 0) {
      points += 1;
    } else {
      missing.push('Agreed Credit Terms');
    }

    const scorePct = Math.round((points / totalPoints) * 100);
    const kycChaseMessage = `Namaste ${sup.name} ji, vendor KYC compliance update ke liye kripya yeh missing details/documents share kijiye: ${missing.join(', ')}. Dhanyawad!`;
    const digits = (sup.phone || '').replace(/\D/g, '');
    const waPhone = digits.length === 10 ? `91${digits}` : digits;
    const whatsappKycUrl = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(kycChaseMessage)}`
      : `https://wa.me/?text=${encodeURIComponent(kycChaseMessage)}`;

    kycScores.push({
      supplierId: sup.id,
      name: sup.name,
      scorePct,
      missingFields: missing,
      whatsappKycUrl,
      kycChaseMessage,
    });

    if (missing.length > 0) {
      incompleteKycSuppliers++;
      pushIfNew({
        kind: 'vendor_kyc_chase',
        priority: 'low',
        title: `Complete Vendor KYC (${scorePct}%): ${sup.name} — Missing ${missing.slice(0, 2).join(', ')}`,
        supplierId: sup.id,
        relatedId: sup.id,
        dueAt: input.todayIso,
        suggestedMessage: kycChaseMessage,
      });
    }
  }

  return {
    plannedTasks,
    kycScores,
    summary: {
      staleRfqsFound,
      overdueDeliveriesFound,
      msmeCliffsFound,
      rule37CliffsFound,
      amcsDueFound,
      incompleteKycSuppliers,
    },
  };
}
