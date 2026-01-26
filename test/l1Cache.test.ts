import { describe, expect, it } from 'vitest';
import { l1Clear, l1Get, l1Set } from '../src/l1Cache';

describe('l1Cache', () => {
  it('returns value before expiry', () => {
    const now = 1_000_000;
    l1Set('key', 'value', 10, now);

    const value = l1Get<string>('key', now + 5_000);

    expect(value).toBe('value');
  });

  it('expires and removes value after ttl', () => {
    const now = 2_000_000;
    l1Set('key', 'value', 1, now);

    const value = l1Get<string>('key', now + 2_000);

    expect(value).toBeNull();
    expect(l1Get<string>('key', now + 2_000)).toBeNull();
  });

  it('treats zero ttl as immediate expiry', () => {
    const now = 3_000_000;
    l1Set('key', 'value', 0, now);

    expect(l1Get<string>('key', now)).toBeNull();
  });

  it('clears all entries', () => {
    const now = 4_000_000;
    l1Set('key1', 'value1', 10, now);
    l1Set('key2', 'value2', 10, now);

    l1Clear();

    expect(l1Get<string>('key1', now)).toBeNull();
    expect(l1Get<string>('key2', now)).toBeNull();
  });
});
