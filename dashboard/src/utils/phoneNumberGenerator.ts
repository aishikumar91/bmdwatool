import {
  ALL_COUNTRY_ENTRIES,
  countryFlag,
  getMobilePattern,
  type CountryEntry,
} from '../data/countryPhoneData';

export interface CountryPhoneConfig {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  region: string;
}

export type VerificationStatus = 'pending' | 'checking' | 'waiting' | 'valid' | 'invalid' | 'error';

export interface GeneratedPhoneNumber {
  id: string;
  countryCode: string;
  countryName: string;
  flag: string;
  dialCode: string;
  nationalNumber: string;
  e164: string;
  whatsappId: string;
  display: string;
  verificationStatus?: VerificationStatus;
  verifiedWhatsappId?: string | null;
  verifiedAt?: string;
  verificationError?: string;
}

export type DistributionMode = 'even' | 'random';

function entryToConfig(entry: CountryEntry): CountryPhoneConfig {
  return {
    code: entry.code,
    name: entry.name,
    dialCode: entry.dialCode,
    flag: countryFlag(entry.code),
    region: entry.region,
  };
}

export const COUNTRY_PHONE_CONFIGS: CountryPhoneConfig[] = ALL_COUNTRY_ENTRIES.map(entryToConfig);

let idCounter = 0;

function randomDigit(): string {
  return Math.floor(Math.random() * 10).toString();
}

function randomDigits(count: number): string {
  let result = '';
  for (let i = 0; i < count; i++) {
    result += randomDigit();
  }
  return result;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function generateNationalNumber(countryCode: string): string {
  const pattern = getMobilePattern(countryCode);
  const prefix = pickRandom(pattern.prefixes);
  return prefix + randomDigits(pattern.suffixLength);
}

export function generatePhoneNumber(country: CountryPhoneConfig): GeneratedPhoneNumber {
  const nationalNumber = generateNationalNumber(country.code);
  const fullNumber = `${country.dialCode}${nationalNumber}`;

  return {
    id: `pn_${Date.now()}_${++idCounter}`,
    countryCode: country.code,
    countryName: country.name,
    flag: country.flag,
    dialCode: country.dialCode,
    nationalNumber,
    e164: `+${fullNumber}`,
    whatsappId: `${fullNumber}@c.us`,
    display: `+${country.dialCode} ${nationalNumber}`,
    verificationStatus: 'pending',
  };
}

export function generatePhoneNumbers(options: {
  countries: CountryPhoneConfig[];
  count: number;
  distribution: DistributionMode;
  dedupe?: boolean;
}): GeneratedPhoneNumber[] {
  const { countries, count, distribution, dedupe = true } = options;
  if (countries.length === 0 || count <= 0) return [];

  const results: GeneratedPhoneNumber[] = [];
  const seen = new Set<string>();
  const maxAttempts = count * 20;
  let attempts = 0;

  const pickCountry = (index: number): CountryPhoneConfig => {
    if (distribution === 'even') {
      return countries[index % countries.length];
    }
    return pickRandom(countries);
  };

  for (let i = 0; i < count && attempts < maxAttempts; attempts++) {
    const country = pickCountry(i);
    const number = generatePhoneNumber(country);
    const key = number.e164;

    if (dedupe && seen.has(key)) {
      continue;
    }

    if (dedupe) seen.add(key);
    results.push(number);
    i++;
  }

  return results;
}

export function getCountryByCode(code: string): CountryPhoneConfig | undefined {
  return COUNTRY_PHONE_CONFIGS.find(c => c.code === code);
}

export function getRegions(): string[] {
  return [...new Set(COUNTRY_PHONE_CONFIGS.map(c => c.region))].sort();
}

export function toDigitsOnly(number: GeneratedPhoneNumber): string {
  return `${number.dialCode}${number.nationalNumber}`;
}

export function exportAsCsv(numbers: GeneratedPhoneNumber[]): string {
  const header = 'Country,Country Code,Dial Code,E.164,WhatsApp ID,National Number,Verified,Verified WhatsApp ID';
  const rows = numbers.map(n =>
    [
      n.countryName,
      n.countryCode,
      n.dialCode,
      n.e164,
      n.whatsappId,
      n.nationalNumber,
      n.verificationStatus === 'valid' ? 'yes' : 'no',
      n.verifiedWhatsappId ?? '',
    ]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

export function exportAsJson(numbers: GeneratedPhoneNumber[]): string {
  return JSON.stringify(numbers, null, 2);
}

export function exportAsPlainText(numbers: GeneratedPhoneNumber[], field: 'e164' | 'whatsappId' | 'display'): string {
  return numbers.map(n => n[field]).join('\n');
}

export { GROUP_PARTICIPANT_LIMIT } from './verificationThrottle';
