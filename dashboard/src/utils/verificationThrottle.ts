export interface ThrottleConfig {
  batchSize: number;
  delayBetweenChecksMs: number;
  pauseBetweenBatchesMs: number;
}

export type ThrottlePreset = 'stealth' | 'slow' | 'normal' | 'fast' | 'custom';

export const THROTTLE_PRESETS: Record<Exclude<ThrottlePreset, 'custom'>, ThrottleConfig> = {
  /** ~10–15 lookups/min with jitter — default for automation experiments */
  stealth: { batchSize: 2, delayBetweenChecksMs: 4500, pauseBetweenBatchesMs: 18000 },
  slow: { batchSize: 2, delayBetweenChecksMs: 3000, pauseBetweenBatchesMs: 10000 },
  normal: { batchSize: 3, delayBetweenChecksMs: 2000, pauseBetweenBatchesMs: 6000 },
  /** Still faster than human; use only for small test batches */
  fast: { batchSize: 4, delayBetweenChecksMs: 1200, pauseBetweenBatchesMs: 4000 },
};

export const STEALTH_BROADCAST_DELAY_MS = 10000;

export const DEFAULT_THROTTLE = THROTTLE_PRESETS.stealth;

export const GROUP_CREATE_DELAY_MS = 8000;
export const BROADCAST_MESSAGE_DELAY_MS = 6000;
export const STEALTH_BROADCAST_MIN_MS = 8000;
export const STEALTH_BROADCAST_MAX_MS = 18000;
/** Soft cap for full automation — warn above this per country */
export const AUTOMATION_RECOMMENDED_MAX_PER_COUNTRY = 50;
export const GROUP_PARTICIPANT_LIMIT = 256;

const THROTTLE_STORAGE_KEY = 'openwa_verify_throttle';
const GROUP_PERMISSION_KEY = 'openwa_auto_group_permission';
const GROUP_DELAY_KEY = 'openwa_group_create_delay';
const BROADCAST_DELAY_KEY = 'openwa_broadcast_message_delay';

export function loadThrottleConfig(): ThrottleConfig {
  try {
    const raw = localStorage.getItem(THROTTLE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THROTTLE };
    const parsed = JSON.parse(raw) as ThrottleConfig;
    return clampThrottle(parsed);
  } catch {
    return { ...DEFAULT_THROTTLE };
  }
}

export function saveThrottleConfig(config: ThrottleConfig): void {
  localStorage.setItem(THROTTLE_STORAGE_KEY, JSON.stringify(clampThrottle(config)));
}

export function clampThrottle(config: ThrottleConfig): ThrottleConfig {
  return {
    batchSize: Math.min(10, Math.max(1, config.batchSize)),
    delayBetweenChecksMs: Math.min(15000, Math.max(2000, config.delayBetweenChecksMs)),
    pauseBetweenBatchesMs: Math.min(60000, Math.max(3000, config.pauseBetweenBatchesMs)),
  };
}

/** Stealth pacing when automation checkbox is on or stealth preset is selected. */
export function isStealthPacing(preset: ThrottlePreset, useStealthMode: boolean): boolean {
  return useStealthMode || preset === 'stealth';
}

export function detectPreset(config: ThrottleConfig): ThrottlePreset {
  for (const [key, preset] of Object.entries(THROTTLE_PRESETS)) {
    if (
      preset.batchSize === config.batchSize &&
      preset.delayBetweenChecksMs === config.delayBetweenChecksMs &&
      preset.pauseBetweenBatchesMs === config.pauseBetweenBatchesMs
    ) {
      return key as ThrottlePreset;
    }
  }
  return 'custom';
}

export function loadAutoGroupPermission(): boolean {
  return localStorage.getItem(GROUP_PERMISSION_KEY) === 'true';
}

export function saveAutoGroupPermission(granted: boolean): void {
  if (granted) localStorage.setItem(GROUP_PERMISSION_KEY, 'true');
  else localStorage.removeItem(GROUP_PERMISSION_KEY);
}

export function loadGroupCreateDelay(): number {
  const raw = localStorage.getItem(GROUP_DELAY_KEY);
  const n = raw ? Number(raw) : GROUP_CREATE_DELAY_MS;
  return Math.min(15000, Math.max(1000, Number.isFinite(n) ? n : GROUP_CREATE_DELAY_MS));
}

export function saveGroupCreateDelay(ms: number): void {
  localStorage.setItem(GROUP_DELAY_KEY, String(Math.min(15000, Math.max(1000, ms))));
}

export function loadBroadcastMessageDelay(): number {
  const raw = localStorage.getItem(BROADCAST_DELAY_KEY);
  const n = raw ? Number(raw) : BROADCAST_MESSAGE_DELAY_MS;
  return Math.min(30000, Math.max(1500, Number.isFinite(n) ? n : BROADCAST_MESSAGE_DELAY_MS));
}

export function saveBroadcastMessageDelay(ms: number): void {
  localStorage.setItem(BROADCAST_DELAY_KEY, String(Math.min(30000, Math.max(1500, ms))));
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
