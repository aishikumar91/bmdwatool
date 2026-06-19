/** Server-side anti-ban defaults — backstop when clients skip dashboard throttles. */

export function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

/** Minimum gap between WhatsApp number lookups (getNumberId) per session. */
export function numberCheckMinDelayMs(): number {
  return positiveIntFromEnv('NUMBER_CHECK_MIN_DELAY_MS', 2500);
}

/** Extra random jitter (0..N ms) added on top of NUMBER_CHECK_MIN_DELAY_MS. */
export function numberCheckJitterMs(): number {
  return positiveIntFromEnv('NUMBER_CHECK_JITTER_MS', 1500);
}

/** Default delay between bulk API messages when caller omits options. */
export function bulkMessageDefaultDelayMs(): number {
  return positiveIntFromEnv('BULK_MESSAGE_DEFAULT_DELAY_MS', 8000);
}

/** Max random add-on for bulk message delay (when randomizeDelay is true). */
export function bulkMessageRandomJitterMs(): number {
  return positiveIntFromEnv('BULK_MESSAGE_RANDOM_JITTER_MS', 4000);
}

/** Purge stored message / batch history on a schedule (reduces local footprint & ban signals). */
export function autoClearSessionHistoryEnabled(): boolean {
  return envFlag('AUTO_CLEAR_SESSION_HISTORY', true);
}

/** Delete messages and completed batches older than this many hours. */
export function autoClearMessageRetentionHours(): number {
  return positiveIntFromEnv('AUTO_CLEAR_MESSAGE_RETENTION_HOURS', 24);
}

/** How often the cleanup job runs (minutes). */
export function autoClearIntervalMinutes(): number {
  return positiveIntFromEnv('AUTO_CLEAR_INTERVAL_MINUTES', 60);
}

/** Purge a session's DB messages immediately after a bulk broadcast completes. */
export function autoClearAfterBroadcastEnabled(): boolean {
  return envFlag('AUTO_CLEAR_AFTER_BROADCAST', true);
}

/** Allow generating / rotating the bootstrap API key from the login page. */
export function allowLoginKeyGeneration(): boolean {
  if (process.env.ALLOW_LOGIN_KEY_GENERATION !== undefined) {
    return envFlag('ALLOW_LOGIN_KEY_GENERATION');
  }
  return process.env.NODE_ENV !== 'production';
}
