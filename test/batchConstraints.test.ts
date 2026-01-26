import { describe, expect, it } from 'vitest';
import { normalizeSymbols } from '../src/symbols';

describe('batch constraints helpers', () => {
  it('filters empty symbols', () => {
    const input = ['2330', ' ', '2317'];
    const normalized = normalizeSymbols(input, 'TW', 'TW');
    expect(normalized.map((item) => item.canonicalSymbol)).toEqual(['2330.TW', '2317.TW']);
  });
});
