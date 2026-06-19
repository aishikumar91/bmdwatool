/** Server-side anti-ban defaults — backstop when clients skip dashboard throttles. */

export function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
