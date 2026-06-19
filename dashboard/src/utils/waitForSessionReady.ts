import { sessionApi } from '../services/api';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface WaitForSessionReadyOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  onWaiting?: (message: string) => void;
  shouldAbort?: () => boolean;
}

const READY = 'ready';
const TERMINAL = new Set(['failed']);

/**
 * Waits until the browser has network and the WhatsApp session is ready again.
 * Used during bulk number verification after a disconnect or API outage.
 */
export async function waitForSessionReady(
  sessionId: string,
  options: WaitForSessionReadyOptions = {},
): Promise<boolean> {
  const maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
  const basePollMs = options.pollIntervalMs ?? 5000;
  const started = Date.now();
  let failures = 0;

  while (Date.now() - started < maxWaitMs) {
    if (options.shouldAbort?.()) {
      return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      options.onWaiting?.('Waiting for network connection…');
      await sleep(basePollMs);
      continue;
    }

    try {
      const session = await sessionApi.get(sessionId);
      failures = 0;
      if (session.status === READY) {
        return true;
      }
      if (TERMINAL.has(session.status)) {
        return false;
      }
      options.onWaiting?.(`WhatsApp session ${session.status} — waiting to reconnect…`);
    } catch {
      failures++;
      options.onWaiting?.(
        failures > 2 ? 'API server unavailable — waiting to reconnect…' : 'Waiting for API server…',
      );
    }

    const backoff = Math.min(basePollMs * Math.pow(1.5, failures), 30_000);
    await sleep(backoff);
  }

  return false;
}

export async function waitForOnline(
  options: Pick<WaitForSessionReadyOptions, 'maxWaitMs' | 'pollIntervalMs' | 'onWaiting' | 'shouldAbort'> = {},
): Promise<boolean> {
  const maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    if (options.shouldAbort?.()) {
      return false;
    }
    if (typeof navigator === 'undefined' || navigator.onLine) {
      return true;
    }
    options.onWaiting?.('Waiting for network connection…');
    await sleep(pollIntervalMs);
  }

  return false;
}
