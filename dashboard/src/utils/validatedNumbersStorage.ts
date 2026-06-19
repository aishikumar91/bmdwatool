import { validatedNumberApi, type ValidatedNumberPayload } from '../services/api';

export type ValidatedNumber = ValidatedNumberPayload;

export interface CountryVault {
  countryCode: string;
  countryName: string;
  flag: string;
  numbers: ValidatedNumber[];
}

const STORAGE_KEY = 'openwa_validated_numbers_vault';

type VaultStore = Record<string, CountryVault>;

function readLocalStore(): VaultStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as VaultStore;
  } catch {
    return {};
  }
}

function writeLocalStore(store: VaultStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function storeFromCountries(countries: CountryVault[]): VaultStore {
  const store: VaultStore = {};
  for (const country of countries) {
    store[country.countryCode] = country;
  }
  return store;
}

export function getVaultCountriesLocal(): CountryVault[] {
  return Object.values(readLocalStore()).sort((a, b) => a.countryName.localeCompare(b.countryName));
}

export function getAllValidatedNumbersLocal(): ValidatedNumber[] {
  return getVaultCountriesLocal().flatMap(v => v.numbers);
}

function saveValidatedNumberLocal(number: ValidatedNumber): void {
  const store = readLocalStore();
  const existing = store[number.countryCode] ?? {
    countryCode: number.countryCode,
    countryName: number.countryName,
    flag: number.flag,
    numbers: [],
  };

  if (!existing.numbers.some(n => n.e164 === number.e164)) {
    existing.numbers.push(number);
    existing.numbers.sort((a, b) => a.e164.localeCompare(b.e164));
  }

  store[number.countryCode] = existing;
  writeLocalStore(store);
}

export async function saveAllVaultToServer(vault: CountryVault[]): Promise<number> {
  const numbers = vault.flatMap(f => f.numbers);
  if (numbers.length === 0) return 0;
  await persistValidatedNumbers(numbers);
  return numbers.length;
}

/** Load vault from server; falls back to local cache if the API is unavailable. */
export async function fetchVaultCountries(): Promise<CountryVault[]> {
  try {
    const data = await validatedNumberApi.list();
    const countries = data.countries ?? [];
    writeLocalStore(storeFromCountries(countries));
    return countries.sort((a, b) => a.countryName.localeCompare(b.countryName));
  } catch {
    return getVaultCountriesLocal();
  }
}

/** One-time migration: push local-only numbers to the server when the vault is empty remotely. */
export async function migrateLocalVaultToServer(): Promise<number> {
  const localNumbers = getAllValidatedNumbersLocal();
  if (localNumbers.length === 0) return 0;

  try {
    const remote = await validatedNumberApi.list();
    if ((remote.total ?? 0) > 0) return 0;

    const result = await validatedNumberApi.saveBulk(localNumbers);
    return result.saved;
  } catch {
    return 0;
  }
}

export async function persistValidatedNumber(number: ValidatedNumber): Promise<void> {
  saveValidatedNumberLocal(number);
  try {
    await validatedNumberApi.save(number);
  } catch {
    // Local cache retained; will sync on next bulk migration or manual export
  }
}

export async function persistValidatedNumbers(numbers: ValidatedNumber[]): Promise<void> {
  for (const number of numbers) {
    saveValidatedNumberLocal(number);
  }
  if (numbers.length === 0) return;
  try {
    await validatedNumberApi.saveBulk(numbers);
  } catch {
    // Local cache retained
  }
}

export async function removeValidatedNumberRemote(countryCode: string, e164: string): Promise<void> {
  const store = readLocalStore();
  const vault = store[countryCode];
  if (vault) {
    vault.numbers = vault.numbers.filter(n => n.e164 !== e164);
    if (vault.numbers.length === 0) delete store[countryCode];
    else store[countryCode] = vault;
    writeLocalStore(store);
  }
  try {
    await validatedNumberApi.removeByE164(e164);
  } catch {
    // local already updated
  }
}

export async function clearCountryVaultRemote(countryCode: string): Promise<void> {
  const store = readLocalStore();
  delete store[countryCode];
  writeLocalStore(store);
  try {
    await validatedNumberApi.removeCountry(countryCode);
  } catch {
    // local already updated
  }
}

export async function clearVaultRemote(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  try {
    await validatedNumberApi.clearAll();
  } catch {
    // local already cleared
  }
}

// Backward-compatible sync helpers used by existing UI code paths
export function loadVault(): VaultStore {
  return readLocalStore();
}

export function getVaultCountries(): CountryVault[] {
  return getVaultCountriesLocal();
}

export function saveValidatedNumber(number: ValidatedNumber): void {
  saveValidatedNumberLocal(number);
  void persistValidatedNumber(number);
}

export function saveValidatedNumbers(numbers: ValidatedNumber[]): void {
  numbers.forEach(saveValidatedNumberLocal);
  void persistValidatedNumbers(numbers);
}

export function removeValidatedNumber(countryCode: string, e164: string): void {
  void removeValidatedNumberRemote(countryCode, e164);
}

export function clearCountryVault(countryCode: string): void {
  void clearCountryVaultRemote(countryCode);
}

export function clearVault(): void {
  void clearVaultRemote();
}

export function getAllValidatedNumbers(): ValidatedNumber[] {
  return getAllValidatedNumbersLocal();
}
