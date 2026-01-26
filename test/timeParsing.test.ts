import { describe, expect, it } from 'vitest';
import { parseTimeHHMM } from '../src/time';

describe('parseTimeHHMM', () => {
  it('parses hour and minute', () => {
    expect(parseTimeHHMM('09:30')).toEqual({ hour: 9, minute: 30 });
  });

  it('handles single digit values', () => {
    expect(parseTimeHHMM('7:5')).toEqual({ hour: 7, minute: 5 });
  });

  it('defaults missing parts to zero', () => {
    expect(parseTimeHHMM('')).toEqual({ hour: 0, minute: 0 });
  });
});
