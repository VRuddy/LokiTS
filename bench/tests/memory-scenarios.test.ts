import { describe, expect, it } from 'vitest';
import type { MemoryEngine } from '../src/core/engine.ts';
import {
  MACRO_SCENARIOS,
  memorySignatures,
  QUERY_SCENARIOS,
  runMemory,
} from '../src/core/memory-scenarios.ts';
import { lokijs } from '../src/engines/shared/lokijs.ts';
import { lokits } from '../src/engines/shared/lokits.ts';

describe('memory scenarios', () => {
  it('produce one row per scenario and size', async () => {
    const out = await runMemory(lokits, { sizes: [200], env: 'node', quick: true });
    const names = out.rows.map((r) => r.scenario).sort();
    expect(names).toEqual([...QUERY_SCENARIOS.map((s) => s.name), ...MACRO_SCENARIOS].sort());
    for (const row of out.rows) {
      expect(row.error).toBeUndefined();
      expect(row.median).toBeGreaterThan(0);
      expect(row).toMatchObject({ family: 'memory', size: 200, engine: 'LokiTS', env: 'node' });
    }
    expect(Object.keys(out.signatures)).toContain('find-eq-scan@200');
  }, 120_000);

  it('give the same signatures for equivalent engines', async () => {
    expect(await memorySignatures(lokijs, 200)).toEqual(await memorySignatures(lokits, 200));
  });

  it('record a failing engine as an error row and keep going', async () => {
    const broken: MemoryEngine = {
      ...lokits,
      name: 'broken',
      create: () => {
        throw new Error('boom');
      },
    };
    const out = await runMemory(broken, {
      sizes: [100],
      env: 'node',
      quick: true,
      scenarios: ['find-eq-scan', 'insert-bulk'],
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.error === 'boom')).toBe(true);
  });
});
