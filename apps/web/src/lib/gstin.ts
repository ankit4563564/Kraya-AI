/**
 * Offline Indian GSTIN Validator & Metadata Extractor using the official GSTN Modulus-36 checksum.
 */

export const INDIAN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

export const PAN_ENTITY_TYPES: Record<string, string> = {
  P: 'Individual / Sole Proprietor',
  H: 'Hindu Undivided Family (HUF)',
  C: 'Company (Pvt Ltd / Public Ltd)',
  F: 'Partnership Firm / LLP',
  A: 'Association of Persons (AOP)',
  B: 'Body of Individuals (BOI)',
  T: 'Trust',
  G: 'Government',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
};

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface GstinValidationResult {
  valid: boolean;
  normalized: string;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  panEntityLabel: string | null;
  expectedChecksum: string | null;
  actualChecksum: string | null;
  errors: string[];
}

export function computeGstinChecksum(first14: string): string {
  const input = first14.trim().toUpperCase();
  if (input.length !== 14) return '';

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = GSTIN_CHARSET.indexOf(input[i]);
    if (codePoint === -1) return '';
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    sum += Math.floor(product / 36) + (product % 36);
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
      pan: null,
      panEntityLabel: null,
      expectedChecksum: null,
      actualChecksum: null,
      errors: ['GSTIN is required'],
    };
  }

  if (normalized.length !== 15) {
    errors.push(`GSTIN must be 15 characters (currently ${normalized.length})`);
  }

  const stateCode = normalized.slice(0, 2);
  const stateName = INDIAN_STATE_CODES[stateCode] || null;
  if (!stateName) {
    errors.push(`Invalid state code '${stateCode}'`);
  }

  if (!GSTIN_REGEX.test(normalized)) {
    errors.push('Format must be 2-digit state + 10-char PAN + 1-char entity + Z + check-digit');
  }

  const pan = normalized.length >= 12 ? normalized.slice(2, 12) : null;
  const entityChar = pan ? pan.charAt(3) : null;
  const panEntityLabel = entityChar ? PAN_ENTITY_TYPES[entityChar] || null : null;

  let expectedChecksum: string | null = null;
  const actualChecksum = normalized.length === 15 ? normalized.charAt(14) : null;

  if (normalized.length === 15) {
    expectedChecksum = computeGstinChecksum(normalized.slice(0, 14));
    if (expectedChecksum && actualChecksum && expectedChecksum !== actualChecksum) {
      errors.push(`Invalid checksum character '${actualChecksum}' (expected '${expectedChecksum}')`);
    }
  }

  return {
    valid: errors.length === 0,
    normalized,
    stateCode: stateName ? stateCode : null,
    stateName,
    pan,
    panEntityLabel,
    expectedChecksum,
    actualChecksum,
    errors,
  };
}
