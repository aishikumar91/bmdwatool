import type { CountryVault } from './validatedNumbersStorage';

export type BroadcastContactStatus = 'pending' | 'sent' | 'failed';

export interface BroadcastContact {
  e164: string;
  whatsappId: string;
  countryCode: string;
  countryName: string;
  status: BroadcastContactStatus;
  error?: string;
  sentAt?: string;
}

export interface BroadcastQueueState {
  sessionId: string;
  message: string;
  delayMs: number;
  contacts: BroadcastContact[];
  templateId?: string;
  templateName?: string;
  useStealth?: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'openwa_broadcast_queue';

export function loadBroadcastQueue(): BroadcastQueueState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BroadcastQueueState;
  } catch {
    return null;
  }
}

export function saveBroadcastQueue(state: BroadcastQueueState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
  );
}

export function clearBroadcastQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createQueueFromVault(
  vault: CountryVault[],
  sessionId: string,
  message: string,
  delayMs: number,
  options?: { templateId?: string; templateName?: string; useStealth?: boolean },
): BroadcastQueueState {
  const contacts: BroadcastContact[] = [];
  for (const folder of vault) {
    for (const n of folder.numbers) {
      if (!n.whatsappId) continue;
      contacts.push({
        e164: n.e164,
        whatsappId: n.whatsappId,
        countryCode: folder.countryCode,
        countryName: folder.countryName,
        status: 'pending',
      });
    }
  }

  const now = new Date().toISOString();
  return {
    sessionId,
    message,
    delayMs,
    contacts,
    templateId: options?.templateId,
    templateName: options?.templateName,
    useStealth: options?.useStealth,
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeQueueWithVault(
  existing: BroadcastQueueState,
  vault: CountryVault[],
): BroadcastQueueState {
  const sentOrFailed = new Map(
    existing.contacts
      .filter(c => c.status !== 'pending')
      .map(c => [c.e164, c]),
  );

  const contacts: BroadcastContact[] = [];
  for (const folder of vault) {
    for (const n of folder.numbers) {
      if (!n.whatsappId) continue;
      const prior = sentOrFailed.get(n.e164);
      contacts.push(
        prior ?? {
          e164: n.e164,
          whatsappId: n.whatsappId,
          countryCode: folder.countryCode,
          countryName: folder.countryName,
          status: 'pending',
        },
      );
    }
  }

  return { ...existing, contacts, updatedAt: new Date().toISOString() };
}

export function getBroadcastStats(state: BroadcastQueueState) {
  const sent = state.contacts.filter(c => c.status === 'sent').length;
  const failed = state.contacts.filter(c => c.status === 'failed').length;
  const pending = state.contacts.filter(c => c.status === 'pending').length;
  return { sent, failed, pending, total: state.contacts.length };
}

export function hasResumableBroadcast(state: BroadcastQueueState | null): boolean {
  return Boolean(state && state.contacts.some(c => c.status === 'pending'));
}
