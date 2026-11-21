/**
 * Multi-sector Indian SMB HSN / SAC Reference Catalog
 * Reflects India GST 2.0 rate rationalization (effective late Sept 2025: 5% & 18% primary slabs,
 * 0% exempt, 40% restricted luxury/sin) plus Section 17(5) Blocked Credit flags.
 */

export interface HsnEntry {
  code: string;
  description: string;
  category:
    | 'packaging'
    | 'raw_material'
    | 'machinery_spares'
    | 'maintenance_amc'
    | 'logistics_gta'
    | 'office_admin'
    | 'blocked_credit';
  gst2RatePct: number; // Post-Sept 2025 primary rate
  legacyPre2025RatePct?: number; // For historical invoice audits
  blockedCredit17_5: boolean;
  blockedCreditReason?: string;
  keywords: string[];
}

export const HSN_CATALOG: HsnEntry[] = [
  // Packaging
  {
    code: '4819',
    description: 'Corrugated boxes, cartons, paperboard cases',
    category: 'packaging',
    gst2RatePct: 5,
    legacyPre2025RatePct: 12,
    blockedCredit17_5: false,
    keywords: ['box', 'boxes', 'carton', 'corrugated', '5-ply', '3-ply', 'packaging'],
  },
  {
    code: '4808',
    description: 'Corrugated paper & kraft paper rolls',
    category: 'packaging',
    gst2RatePct: 18,
    legacyPre2025RatePct: 12,
    blockedCredit17_5: false,
    keywords: ['kraft', 'paper roll', 'corrugated roll'],
  },
  {
    code: '3920',
    description: 'BOPP tape, stretch film, LDPE/HDPE packaging film',
    category: 'packaging',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['tape', 'bopp', 'stretch film', 'shrink', 'polybag', 'ldpe', 'hdpe', 'pouch'],
  },
  {
    code: '3923',
    description: 'Plastic crates, drums, bottles, caps, containers',
    category: 'packaging',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['drum', 'crate', 'bottle', 'jar', 'container', 'plastic cap', 'jerrycan'],
  },
  // Raw Materials & Hardware
  {
    code: '7208',
    description: 'Hot-rolled steel sheets, coils, MS plates',
    category: 'raw_material',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['steel', 'ms plate', 'hr coil', 'cr sheet', 'tmt', 'iron'],
  },
  {
    code: '7318',
    description: 'Screws, bolts, nuts, washers, industrial fasteners',
    category: 'raw_material',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['bolt', 'nut', 'screw', 'fastener', 'washer', 'hardware'],
  },
  {
    code: '2710',
    description: 'Industrial lubricants, hydraulic oil, gear oil, cutting oil',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['lubricant', 'hydraulic oil', 'gear oil', 'engine oil', 'cutting oil', 'grease'],
  },
  {
    code: '8482',
    description: 'Ball bearings, roller bearings & machinery spares',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['bearing', 'spare', 'spares', 'belt', 'v-belt', 'filter', 'seal', 'valve'],
  },
  {
    code: '8502',
    description: 'DG sets, electric generating sets & spares',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['dg set', 'generator', 'genset', 'alternator'],
  },
  {
    code: '5208',
    description: 'Woven cotton fabrics & industrial cloth',
    category: 'raw_material',
    gst2RatePct: 5,
    blockedCredit17_5: false,
    keywords: ['fabric', 'cotton', 'cloth', 'textile', 'yarn'],
  },
  // High-Demand Indian SMB Light Manufacturing, Engineering & Construction/Hardware Packs
  {
    code: '3901',
    description: 'LDPE / HDPE / PP polymer granules & plastic resins',
    category: 'raw_material',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['granules', 'polymer', 'resin', 'pp', 'hdpe granules', 'ldpe granules', 'moulding'],
  },
  {
    code: '8413',
    description: 'Industrial pumps, submersible pumps, hydraulic pumps & spares',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['pump', 'submersible', 'impeller', 'hydraulic pump', 'monoblock'],
  },
  {
    code: '8501',
    description: 'Industrial electric motors & drives',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['motor', 'electric motor', 'induction motor', 'vfd', 'gear motor'],
  },
  {
    code: '8536',
    description: 'Electrical switchgear, MCBs, relays, contactors & control panels',
    category: 'machinery_spares',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['switchgear', 'mcb', 'contactor', 'relay', 'panel', 'electrical', 'cable'],
  },
  {
    code: '7214',
    description: 'TMT steel bars, structural rods & iron bars',
    category: 'raw_material',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['tmt', 'steel bar', 'rebar', 'rod', 'structural steel', 'angle', 'channel'],
  },
  {
    code: '2523',
    description: 'Portland cement & industrial binding cement',
    category: 'raw_material',
    gst2RatePct: 18,
    legacyPre2025RatePct: 28,
    blockedCredit17_5: false,
    keywords: ['cement', 'opc', 'ppc', 'portland'],
  },
  {
    code: '4412',
    description: 'Commercial plywood, marine ply & laminated boards',
    category: 'raw_material',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['plywood', 'marine ply', 'mdf', 'blockboard', 'timber', 'laminate'],
  },
  // Services / AMC / Logistics
  {
    code: '9987',
    description: 'Maintenance, repair & AMC services for machinery/equipment',
    category: 'maintenance_amc',
    gst2RatePct: 18,
    blockedCredit17_5: false,
    keywords: ['amc', 'maintenance', 'repair', 'servicing', 'calibration', 'overhaul'],
  },
  {
    code: '9965',
    description: 'Goods Transport Agency (GTA) road freight services',
    category: 'logistics_gta',
    gst2RatePct: 5, // Default 5% RCM or 18% FCM
    blockedCredit17_5: false,
    keywords: ['freight', 'transport', 'gta', 'bhada', 'lorry', 'bilty', 'consignment'],
  },
  // Section 17(5) Blocked Credits
  {
    code: '9963',
    description: 'Food, beverages, outdoor catering & staff canteen (non-statutory)',
    category: 'blocked_credit',
    gst2RatePct: 5,
    blockedCredit17_5: true,
    blockedCreditReason: 'Section 17(5)(b): Food, beverages, and outdoor catering ITC is blocked unless statutorily mandated.',
    keywords: ['catering', 'food', 'lunch', 'snacks', 'beverages', 'restaurant'],
  },
  {
    code: '8703',
    description: 'Passenger motor vehicles (seating capacity <= 13 persons)',
    category: 'blocked_credit',
    gst2RatePct: 18,
    legacyPre2025RatePct: 28,
    blockedCredit17_5: true,
    blockedCreditReason: 'Section 17(5)(a): ITC blocked on passenger motor vehicles with seating capacity <= 13.',
    keywords: ['passenger car', 'sedan', 'suv', 'company car'],
  },
  {
    code: '9954',
    description: 'Works contract / civil construction of immovable property',
    category: 'blocked_credit',
    gst2RatePct: 18,
    blockedCredit17_5: true,
    blockedCreditReason: 'Section 17(5)(c)/(d): ITC blocked on works contract / civil construction of immovable property (except plant & machinery).',
    keywords: ['civil work', 'building renovation', 'factory shed construction', 'flooring', 'painting building'],
  },
];

export function lookupHsn(codeOrText: string | null | undefined): HsnEntry | null {
  if (!codeOrText) return null;
  const cleaned = codeOrText.trim().toLowerCase();
  const numericPrefix = cleaned.replace(/[^0-9]/g, '');

  if (numericPrefix.length >= 4) {
    const exact = HSN_CATALOG.find(
      (h) => numericPrefix.startsWith(h.code) || h.code.startsWith(numericPrefix.slice(0, 4))
    );
    if (exact) return exact;
  }

  for (const entry of HSN_CATALOG) {
    if (entry.keywords.some((kw) => cleaned.includes(kw))) {
      return entry;
    }
  }
  return null;
}
