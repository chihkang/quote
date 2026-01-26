type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const l1Cache = new Map<string, CacheEntry<unknown>>();

export function l1Get<T>(key: string, now = Date.now()): T | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    l1Cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function l1Set<T>(key: string, value: T, ttlSec: number, now = Date.now()): void {
  const expiresAt = now + Math.max(0, ttlSec) * 1000;
  l1Cache.set(key, { value, expiresAt });
}

export function l1Clear(): void {
  l1Cache.clear();
}
