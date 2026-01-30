export type QuoteCacheValue = {
  symbol: string;
  canonicalSymbol: string;
  market: 'TW' | 'US';
  price: number | null;
  currency: string | null;
  asOf: string | null;
  fetchedAt: string;
  softTtlJitterSec?: number;
};

export type EnvWithKV = {
  QUOTES_KV: KVNamespace;
};

export async function getQuote(env: EnvWithKV, key: string): Promise<QuoteCacheValue | null> {
  const raw = await env.QUOTES_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuoteCacheValue;
  } catch {
    return null;
  }
}

export async function putQuote(
  env: EnvWithKV,
  key: string,
  value: QuoteCacheValue,
  expirationTtlSec?: number
): Promise<void> {
  const ttl = typeof expirationTtlSec === 'number' && expirationTtlSec > 0 ? expirationTtlSec : undefined;
  await env.QUOTES_KV.put(
    key,
    JSON.stringify(value),
    ttl ? { expirationTtl: Math.floor(ttl) } : undefined
  );
}
