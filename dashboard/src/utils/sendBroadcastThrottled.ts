import { messageApi } from '../services/api';
import { waitForSessionReady } from './waitForSessionReady';
import {
  type BroadcastContact,
  type BroadcastQueueState,
  saveBroadcastQueue,
} from './broadcastQueueStorage';
import { humanPause, humanPauseRange } from './humanDelay';
import {
  STEALTH_BROADCAST_MAX_MS,
  STEALTH_BROADCAST_MIN_MS,
} from './verificationThrottle';

const RETRYABLE = /502|503|504|409|not connected|not ready|network|fetch failed|detached|protocol error/i;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface RunBroadcastOptions {
  state: BroadcastQueueState;
  sessionId: string;
  delayMs: number;
  onProgress?: (done: number, total: number, current: BroadcastContact | null) => void;
  onWaiting?: (message: string) => void;
  shouldAbort?: () => boolean;
}

function buildTemplateVars(contact: BroadcastContact): Record<string, string> {
  return {
    e164: contact.e164,
    phone: contact.e164,
    country: contact.countryName,
    countryName: contact.countryName,
    countryCode: contact.countryCode,
    name: contact.countryName,
  };
}

async function sendWithRetry(
  sessionId: string,
  contact: BroadcastContact,
  state: BroadcastQueueState,
  options: Pick<RunBroadcastOptions, 'onWaiting' | 'shouldAbort'>,
): Promise<void> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.shouldAbort?.()) {
      throw new Error('Broadcast cancelled');
    }

    try {
      if (state.templateId || state.templateName) {
        await messageApi.sendTemplate(sessionId, {
          chatId: contact.whatsappId,
          templateId: state.templateId,
          templateName: state.templateName,
          vars: buildTemplateVars(contact),
        });
      } else {
        await messageApi.sendText(sessionId, contact.whatsappId, state.message);
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!RETRYABLE.test(message) || attempt === maxAttempts - 1) {
        throw error;
      }

      const recovered = await waitForSessionReady(sessionId, {
        onWaiting: options.onWaiting,
        shouldAbort: options.shouldAbort,
      });
      if (!recovered) {
        throw error;
      }
    }

    await sleep(1500 * (attempt + 1));
  }
}

async function pauseBetweenMessages(delayMs: number, useStealth?: boolean): Promise<void> {
  if (useStealth) {
    await humanPauseRange(STEALTH_BROADCAST_MIN_MS, STEALTH_BROADCAST_MAX_MS);
    return;
  }
  // Non-stealth still uses jitter — never send at a fixed metronomic interval
  await humanPause(Math.max(delayMs, 5000), 0.35);
}

export async function runBroadcastQueue(options: RunBroadcastOptions): Promise<BroadcastQueueState> {
  const { sessionId, delayMs, onProgress, onWaiting, shouldAbort } = options;
  const state = { ...options.state, sessionId, delayMs };
  const pending = state.contacts.filter(c => c.status === 'pending');
  const total = state.contacts.length;
  let done = state.contacts.filter(c => c.status !== 'pending').length;

  onProgress?.(done, total, null);

  for (let i = 0; i < pending.length; i++) {
    if (shouldAbort?.()) break;

    const contact = pending[i];
    onProgress?.(done, total, contact);

    const idx = state.contacts.findIndex(c => c.e164 === contact.e164);
    if (idx < 0) continue;

    try {
      await sendWithRetry(sessionId, contact, state, { onWaiting, shouldAbort });
      state.contacts[idx] = {
        ...contact,
        status: 'sent',
        sentAt: new Date().toISOString(),
        error: undefined,
      };
    } catch (error) {
      state.contacts[idx] = {
        ...contact,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Send failed',
      };
    }

    done++;
    saveBroadcastQueue(state);
    onProgress?.(done, total, null);

    const hasMore = i < pending.length - 1;
    if (hasMore && !shouldAbort?.()) {
      await pauseBetweenMessages(delayMs, state.useStealth);
    }
  }

  saveBroadcastQueue(state);
  return state;
}
