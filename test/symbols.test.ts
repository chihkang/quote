import { describe, expect, it } from 'vitest';
import { normalizeSymbols } from '../src/symbols';

describe('normalizeSymbols', () => {
  it('dedupes by canonical symbol and preserves order', () => {
    const input = ['2330', '2330.TW', '2317'];
    const result = normalizeSymbols(input, undefined, 'TW');

    expect(result.map((item) => item.canonicalSymbol)).toEqual(['2330.TW', '2317.TW']);
    expect(result[0].originalSymbol).toBe('2330');
    expect(result[1].originalSymbol).toBe('2317');
  });

  it('dedupes with market override', () => {
    const input = ['AAPL.US', 'AAPL'];
    const result = normalizeSymbols(input, 'US', 'TW');

    expect(result.map((item) => item.canonicalSymbol)).toEqual(['AAPL.US']);
    expect(result[0].originalSymbol).toBe('AAPL.US');
  });
});
