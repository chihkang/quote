export type Market = 'TW' | 'US';

export type NormalizedSymbol = {
  originalSymbol: string;
  ticker: string;
  market: Market;
  canonicalSymbol: string;
  kvKey: string;
};

const MARKET_ALIASES: Record<string, Market> = {
  TW: 'TW',
  TPE: 'TW',
  TWO: 'TW',
  US: 'US',
  NASDAQ: 'US',
  NYSE: 'US',
  AMEX: 'US'
};

function normalizeMarket(value: string | undefined, fallback: Market): Market {
  if (!value) return fallback;
  const upper = value.toUpperCase();
  return MARKET_ALIASES[upper] ?? fallback;
}

function splitSymbol(input: string): { ticker: string; marketHint?: string } {
  if (input.includes(':')) {
    const [left, right] = input.split(':');
    return { ticker: right ?? '', marketHint: left };
  }
  if (input.includes('.')) {
    const [left, right] = input.split('.');
    return { ticker: left ?? '', marketHint: right };
  }
  return { ticker: input };
}

export function normalizeSymbol(
  input: string,
  marketOverride: string | undefined,
  defaultMarket: string
): NormalizedSymbol {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  const { ticker, marketHint } = splitSymbol(upper);

  const fallback = normalizeMarket(defaultMarket, 'TW');
  const market = normalizeMarket(marketOverride ?? marketHint, fallback);
  const canonicalSymbol = `${ticker}.${market}`;
  const kvKey = `quote:${market}:${ticker}`;

  return {
    originalSymbol: input,
    ticker,
    market,
    canonicalSymbol,
    kvKey
  };
}

export function normalizeSymbols(
  symbols: string[],
  marketOverride: string | undefined,
  defaultMarket: string
): NormalizedSymbol[] {
  const seen = new Set<string>();
  const result: NormalizedSymbol[] = [];

  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol, marketOverride, defaultMarket);
    if (!normalized.ticker) continue;
    if (seen.has(normalized.canonicalSymbol)) continue;
    seen.add(normalized.canonicalSymbol);
    result.push(normalized);
  }

  return result;
}
