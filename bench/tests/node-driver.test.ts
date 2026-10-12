import { describe, expect, it } from 'vitest';
import type { ChildOutput } from '../src/core/results.ts';
import { combineRounds, flagMismatches } from '../src/node.ts';

const out = (engine: string, signature: string): ChildOutput => ({
  engine: { name: engine, packageName: engine, notes: '' },
  signatures: { 'find-eq-scan@100': signature },
  rows: [
    {
      family: 'memory',
      scenario: 'find-eq-scan',
      size: 100,
      engine,
      env: 'node',
      median: 1,
      p75: 1,
      p99: 1,
      samples: 1,
    },
  ],
});

describe('flagMismatches', () => {
  it('turns rows with a different answer into errors', () => {
    const outputs = new Map([
      ['lokits', out('LokiTS', 'aaaa')],
      ['lokijs', out('lokijs', 'aaaa')],
      ['other', out('Other', 'bbbb')],
    ]);
    flagMismatches(outputs, 'lokits');
    expect(outputs.get('lokijs')?.rows[0].error).toBeUndefined();
    expect(outputs.get('other')?.rows[0].error).toBe('result differs from LokiTS');
    expect(Number.isNaN(outputs.get('other')?.rows[0].median)).toBe(true);
  });
});

describe('combineRounds', () => {
  it('keeps, per scenario, the row whose median is the median of the rounds', () => {
    const round = (median: number): ChildOutput => {
      const o = out('LokiTS', 'aaaa');
      o.rows[0] = { ...o.rows[0], median, p75: median + 1 };
      return o;
    };
    const combined = combineRounds([round(5), round(1), round(3)]);
    expect(combined.rows).toHaveLength(1);
    expect(combined.rows[0]).toMatchObject({ median: 3, p75: 4 });
    expect(combined.signatures).toEqual({ 'find-eq-scan@100': 'aaaa' });
  });

  it('prefers successful rounds over errors', () => {
    const failed = out('LokiTS', 'aaaa');
    failed.rows[0] = { ...failed.rows[0], median: Number.NaN, error: 'boom' };
    expect(combineRounds([failed, out('LokiTS', 'aaaa')]).rows[0].error).toBeUndefined();
  });
});
