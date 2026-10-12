import { describe, expect, it } from 'vitest';
import { fnv1a, summarize } from '../src/core/stats.ts';

describe('summarize', () => {
  it('uses nearest-rank percentiles', () => {
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ median: 3, p75: 4, p99: 5, samples: 5 });
    expect(summarize([4, 1, 3, 2]).median).toBe(2);
    expect(summarize([7])).toEqual({ median: 7, p75: 7, p99: 7, samples: 1 });
  });

  it('rejects an empty sample', () => {
    expect(() => summarize([])).toThrow('no samples');
  });
});

describe('fnv1a', () => {
  it('is stable and sensitive to order', () => {
    expect(fnv1a('1,2,3')).toBe(fnv1a('1,2,3'));
    expect(fnv1a('1,2,3')).not.toBe(fnv1a('3,2,1'));
    expect(fnv1a('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
