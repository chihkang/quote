import { describe, expect, it } from 'vitest';
import { classify } from '../src/quotePolicy';

describe('classify', () => {
  it('classifies fresh', () => {
    const now = 1_000_000;
    const fetchedAt = now - 60_000;
    expect(classify(now, fetchedAt, 300, 3600)).toBe('fresh');
  });

  it('classifies stale', () => {
    const now = 1_000_000;
    const fetchedAt = now - 600_000;
    expect(classify(now, fetchedAt, 300, 3600)).toBe('stale');
  });

  it('classifies missing', () => {
    const now = 1_000_000;
    const fetchedAt = now - 4_000_000;
    expect(classify(now, fetchedAt, 300, 3600)).toBe('missing');
  });

  it('respects jitter', () => {
    const now = 1_000_000;
    const fetchedAt = now - 350_000;
    expect(classify(now, fetchedAt, 300, 3600, 100)).toBe('fresh');
  });
});
