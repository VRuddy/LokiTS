import { describe, expect, it } from 'vitest';
import type { ChildOutput } from '../src/core/results.ts';
import { flagMismatches } from '../src/node.ts';

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
