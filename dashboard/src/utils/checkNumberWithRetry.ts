import { contactApi, type NumberCheckResult } from '../services/api';
import { jitterMs } from './humanDelay';
import { waitForOnline, waitForSessionReady } from './waitForSessionReady';

const RETRYABLE_HTTP =
  /detached|evaluation failed|target closed|protocol error|execution context|not ready|not connected|failed to fetch|network|load failed|500|502|503|504|429|409|conflict/i;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface CheckNumberOptions {
  maxAttempts?: number;
  onWaiting?: (message: string) => void;
  shouldAbort?: () => boolean;
}

function isRetryableFailure(result: NumberCheckResult): boolean {
  return Boolean(result.retryable || result.sessionNotReady || result.error);
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_HTTP.test(message);
}

async function waitForRecoverableSession(
  sessionId: string,
  options: CheckNumberOptions,
): Promise<boolean> {
  const online = await waitForOnline({
    onWaiting: options.onWaiting,
    shouldAbort: options.shouldAbort,
  });
  if (!online) {
    return false;
  }

  return waitForSessionReady(sessionId, {
    onWaiting: options.onWaiting,
    shouldAbort: options.shouldAbort,
  });
}

export async function checkNumberWithRetry(
  sessionId: string,
  digits: string,
  options: CheckNumberOptions = {},
): Promise<NumberCheckResult> {
  const maxAttempts = options.maxAttempts ?? 6;
  let lastResult: NumberCheckResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.shouldAbort?.()) {
      return (
        lastResult ?? {
          number: digits,
          exists: false,
          whatsappId: null,
          error: 'Verification cancelled',
          retryable: true,
        }
      );
    }

    try {
      const result = await contactApi.checkNumber(sessionId, digits);
      lastResult = result;

      if (result.exists || !isRetryableFailure(result)) {
        return result;
      }

      if (attempt < maxAttempts - 1) {
        const recovered = await waitForRecoverableSession(sessionId, options);
        if (!recovered) {
          return {
            ...result,
            error: result.error ?? 'Session did not recover in time',
            retryable: true,
            sessionNotReady: true,
          };
        }
      }
    } catch (error) {
      if (!isRetryableError(error) || attempt === maxAttempts - 1) {
        throw error;
      }

      const recovered = await waitForRecoverableSession(sessionId, options);
      if (!recovered) {
        throw error;
      }
    }

    await sleep(jitterMs(2000 * (attempt + 1), 0.4));
  }

  return (
    lastResult ?? {
      number: digits,
      exists: false,
      whatsappId: null,
      error: 'Number check failed after retries',
      retryable: true,
    }
  );
}
