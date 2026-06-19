/**
 * Waits for the Nest API health endpoint before starting the Vite dashboard.
 * Used by `npm run dev` to avoid "Failed to fetch" on the login page during API boot.
 */
const HEALTH_URL = process.env.API_HEALTH_URL ?? 'http://127.0.0.1:2785/api/infra/health';
const TIMEOUT_MS = Number(process.env.API_WAIT_TIMEOUT_MS ?? 120_000);
const POLL_MS = 1500;

const start = Date.now();

async function ping() {
  const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(4000) });
  return res.ok;
}

while (Date.now() - start < TIMEOUT_MS) {
  try {
    if (await ping()) {
      console.log(`[wait-for-api] API ready at ${HEALTH_URL}`);
      // Exit 0 normally — do not call process.exit() on success (crashes on some Windows Node builds).
      break;
    }
  } catch {
    // still booting
  }
  await new Promise(r => setTimeout(r, POLL_MS));
}

if (Date.now() - start >= TIMEOUT_MS) {
  console.error(`[wait-for-api] Timed out after ${TIMEOUT_MS}ms waiting for ${HEALTH_URL}`);
  console.error('[wait-for-api] Start the API manually: npm run start:dev');
  process.exitCode = 1;
}
