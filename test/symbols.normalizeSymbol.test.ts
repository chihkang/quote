import { describe, expect, it } from 'vitest';
import { normalizeSymbol } from '../src/symbols';

describe('normalizeSymbol', () => {
  it('normalizes dot market suffix', () => {
    const normalized = normalizeSymbol('2330.TW', undefined, 'TW');

    expect(normalized).toMatchObject({
      ticker: '2330',
      market: 'TW',
      canonicalSymbol: '2330.TW',
      kvKey: 'quote:TW:2330'
    });
  });

  it('normalizes colon market prefix', () => {
    const normalized = normalizeSymbol('US:AAPL', undefined, 'TW');

    expect(normalized).toMatchObject({
      ticker: 'AAPL',
      market: 'US',
      canonicalSymbol: 'AAPL.US',
      kvKey: 'quote:US:AAPL'
    });
  });

  it('uses market override when provided', () => {
    const normalized = normalizeSymbol('AAPL', 'US', 'TW');

    expect(normalized.market).toBe('US');
    expect(normalized.canonicalSymbol).toBe('AAPL.US');
  });

  it('falls back to default market', () => {
    const normalized = normalizeSymbol('2330', undefined, 'TW');

    expect(normalized.market).toBe('TW');
  });
});
