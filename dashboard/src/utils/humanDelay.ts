/** Random delay helpers — mimic human pacing and reduce ban risk. */

export function jitterMs(baseMs: number, varianceRatio = 0.35): number {
  const variance = baseMs * varianceRatio;
  const min = Math.max(0, baseMs - variance);
  const max = baseMs + variance;
  return Math.round(min + Math.random() * (max - min));
}

export function randomBetween(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

export async function humanPause(baseMs: number, varianceRatio = 0.35): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, jitterMs(baseMs, varianceRatio)));
}

export async function humanPauseRange(minMs: number, maxMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, randomBetween(minMs, maxMs)));
}
