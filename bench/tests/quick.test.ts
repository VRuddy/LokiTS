import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/results.ts';
import { checkRatios, computeRatios } from '../src/quick.ts';

const row = (
  engine: string,
  scenario: string,
  median: number,
  family: 'memory' | 'persistence' = 'memory',
): ResultRow => ({
  family,
  scenario,
  size: 10_000,
  engine,
  env: 'node',
  median,
  p75: median,
  p99: median,
  samples: 3,
});

describe('quick guard', () => {
  it('computes LokiTS / lokijs ratios per scenario', () => {
    const ratios = computeRatios([
      row('LokiTS', 'find-eq-scan', 2),
      row('lokijs', 'find-eq-scan', 4),
      row('LokiTS', 'write-all', 30, 'persistence'),
      row('lokijs', 'write-all', 10, 'persistence'),
    ]);
    expect(ratios).toEqual({ 'find-eq-scan': 0.5, 'write-all': 3 });
  });

  it('fails only when a ratio grows beyond baseline × threshold', () => {
    const baseline = { 'find-eq-scan': 1, 'write-all': 3 };
    expect(checkRatios({ 'find-eq-scan': 1.1, 'write-all': 3.3 }, baseline, 1.15)).toEqual([]);
    expect(checkRatios({ 'find-eq-scan': 1.2, 'write-all': 3 }, baseline, 1.15)).toEqual([
      'find-eq-scan: ratio 1.20, baseline 1.00 (limit 1.15)',
    ]);
  });

  it('ignores scenarios missing from the baseline', () => {
    expect(checkRatios({ 'sort-limit': 9 }, {}, 1.15)).toEqual([]);
  });
});
