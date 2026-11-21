/**
 * Official Indian GSTIN (15-character) Validator & Metadata Extractor.
 * Runs 100% offline in <1ms using the official GSTN Modulus-36 checksum algorithm.
 */

export const INDIAN_STATE_CODES: Record<string, { name: string; isUt: boolean }> = {
  '01': { name: 'Jammu and Kashmir', isUt: true },
  '02': { name: 'Himachal Pradesh', isUt: false },
  '03': { name: 'Punjab', isUt: false },
  '04': { name: 'Chandigarh', isUt: true },
  '05': { name: 'Uttarakhand', isUt: false },
  '06': { name: 'Haryana', isUt: false },
  '07': { name: 'Delhi', isUt: true },
  '08': { name: 'Rajasthan', isUt: false },
  '09': { name: 'Uttar Pradesh', isUt: false },
  '10': { name: 'Bihar', isUt: false },
  '11': { name: 'Sikkim', isUt: false },
  '12': { name: 'Arunachal Pradesh', isUt: false },
  '13': { name: 'Nagaland', isUt: false },
  '14': { name: 'Manipur', isUt: false },
  '15': { name: 'Mizoram', isUt: false },
  '16': { name: 'Tripura', isUt: false },
  '17': { name: 'Meghalaya', isUt: false },
  '18': { name: 'Assam', isUt: false },
  '19': { name: 'West Bengal', isUt: false },
  '20': { name: 'Jharkhand', isUt: false },
  '21': { name: 'Odisha', isUt: false },
  '22': { name: 'Chhattisgarh', isUt: false },
  '23': { name: 'Madhya Pradesh', isUt: false },
  '24': { name: 'Gujarat', isUt: false },
  '26': { name: 'Dadra and Nagar Haveli and Daman and Diu', isUt: true },
  '27': { name: 'Maharashtra', isUt: false },
  '28': { name: 'Andhra Pradesh (Old)', isUt: false },
  '29': { name: 'Karnataka', isUt: false },
  '30': { name: 'Goa', isUt: false },
  '31': { name: 'Lakshadweep', isUt: true },
  '32': { name: 'Kerala', isUt: false },
  '33': { name: 'Tamil Nadu', isUt: false },
  '34': { name: 'Puducherry', isUt: true },
  '35': { name: 'Andaman and Nicobar Islands', isUt: true },
  '36': { name: 'Telangana', isUt: false },
  '37': { name: 'Andhra Pradesh', isUt: false },
  '38': { name: 'Ladakh', isUt: true },
  '97': { name: 'Other Territory', isUt: true },
  '99': { name: 'Centre Jurisdiction', isUt: false },
};

export const PAN_ENTITY_TYPES: Record<string, { label: string; tds194cRatePct: number }> = {
  P: { label: 'Individual / Sole Proprietor', tds194cRatePct: 1 },
  H: { label: 'Hindu Undivided Family (HUF)', tds194cRatePct: 1 },
  C: { label: 'Company (Pvt Ltd / Public Ltd)', tds194cRatePct: 2 },
  F: { label: 'Partnership Firm / LLP', tds194cRatePct: 2 },
  A: { label: 'Association of Persons (AOP)', tds194cRatePct: 2 },
  B: { label: 'Body of Individuals (BOI)', tds194cRatePct: 2 },
  T: { label: 'Trust', tds194cRatePct: 2 },
  G: { label: 'Government', tds194cRatePct: 2 },
  L: { label: 'Local Authority', tds194cRatePct: 2 },
  J: { label: 'Artificial Juridical Person', tds194cRatePct: 2 },
};

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface GstinValidationResult {
  valid: boolean;
  normalized: string;
  stateCode: string | null;
  stateName: string | null;
  isUnionTerritory: boolean;
  pan: string | null;
  panEntityCode: string | null;
  panEntityLabel: string | null;
  tds194cRatePct: number | null;
  entityNumber: string | null;
  expectedChecksum: string | null;
  actualChecksum: string | null;
  errors: string[];
}

/**
 * Computes the official GSTN 15th check character for a 14-character GSTIN prefix
 * using the Modulus-36 alternating-weight algorithm (weights 1, 2 from index 0).
 */
export function computeGstinChecksum(first14: string): string {
  const input = first14.trim().toUpperCase();
  if (input.length !== 14) {
    throw new Error(`Expected 14-character GSTIN prefix, got ${input.length}`);
  }

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = GSTIN_CHARSET.indexOf(input[i]);
    if (codePoint === -1) {
      throw new Error(`Invalid GSTIN character '${input[i]}' at index ${i}`);
    }
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const checkCodePoint = (36 - (sum % 36)) % 36;
  return GSTIN_CHARSET[checkCodePoint];
}

export function validateGstin(rawGstin: string | null | undefined): GstinValidationResult {
  const errors: string[] = [];
  const normalized = (rawGstin ?? '').replace(/[\s-]/g, '').toUpperCase();

  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      stateCode: null,
      stateName: null,
      isUnionTerritory: false,
      pan: null,
      panEntityCode: null,
      panEntityLabel: null,
      tds194cRatePct: null,
      entityNumber: null,
      expectedChecksum: null,
      actualChecksum: null,
      errors: ['GSTIN is empty'],
    };
  }

  if (normalized.length !== 15) {
    errors.push(`GSTIN must be 15 characters (found ${normalized.length})`);
  }

  const stateCode = normalized.slice(0, 2);
  const stateInfo = INDIAN_STATE_CODES[stateCode];
  if (!stateInfo) {
    errors.push(`Invalid Indian GST state code '${stateCode}'`);
  }

  if (!GSTIN_REGEX.test(normalized)) {
    errors.push('GSTIN does not match standard format (2-digit state + 10-char PAN + entity + Z + checksum)');
  }

  const pan = normalized.length >= 12 ? normalized.slice(2, 12) : null;
  const panEntityCode = pan ? pan[3] : null;
  const entityMeta = panEntityCode ? PAN_ENTITY_TYPES[panEntityCode] : undefined;
  if (pan && !entityMeta) {
    errors.push(`Unrecognized PAN 4th-character entity code '${panEntityCode}'`);
  }

  let expectedChecksum: string | null = null;
  const actualChecksum = normalized.length === 15 ? normalized[14] : null;
  if (normalized.length === 15 && /^[0-9A-Z]{15}$/.test(normalized)) {
    expectedChecksum = computeGstinChecksum(normalized.slice(0, 14));
    if (actualChecksum !== expectedChecksum) {
      errors.push(
        `Checksum mismatch: 15th char is '${actualChecksum}', expected '${expectedChecksum}' (likely typo or fake GSTIN)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    normalized,
    stateCode: stateInfo ? stateCode : null,
    stateName: stateInfo ? stateInfo.name : null,
    isUnionTerritory: stateInfo?.isUt ?? false,
    pan,
    panEntityCode,
    panEntityLabel: entityMeta?.label ?? null,
    tds194cRatePct: entityMeta?.tds194cRatePct ?? null,
    entityNumber: normalized.length >= 13 ? normalized[12] : null,
    expectedChecksum,
    actualChecksum,
    errors,
  };
}

export function getStateName(stateCode: string | null | undefined): string {
  if (!stateCode) return 'Unknown State';
  return INDIAN_STATE_CODES[stateCode]?.name ?? `State ${stateCode}`;
}
