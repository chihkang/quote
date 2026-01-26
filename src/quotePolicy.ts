export type QuoteStatus = 'fresh' | 'stale' | 'missing';

export function classify(
  nowMs: number,
  fetchedAtMs: number,
  softTtlSec: number,
  hardTtlSec: number,
  softTtlJitterSec = 0
): QuoteStatus {
  const ageMs = Math.max(0, nowMs - fetchedAtMs);
  const softMs = Math.max(0, softTtlSec + softTtlJitterSec) * 1000;
  const hardMs = Math.max(0, hardTtlSec) * 1000;

  if (ageMs <= softMs) return 'fresh';
  if (ageMs <= hardMs) return 'stale';
  return 'missing';
}

export function isStale(status: QuoteStatus): boolean {
  return status === 'stale';
}
