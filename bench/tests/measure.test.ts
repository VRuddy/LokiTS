import { describe, expect, it } from 'vitest';
import { measureOp, sampleMacro } from '../src/core/measure.ts';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('measureOp', () => {
  it('awaits async operations', async () => {
    const s = await measureOp(() => wait(2), false, true);
    expect(s.median).toBeGreaterThanOrEqual(1.5);
  });

  it('measures sync operations in milliseconds', async () => {
    const s = await measureOp(() => Math.sqrt(2), true, true);
    expect(s.median).toBeLessThan(0.01);
    expect(s.samples).toBeGreaterThan(0);
  });
});

describe('sampleMacro', () => {
  it('times only run, per operation, with a fresh setup each sample', async () => {
    let setups = 0;
    let teardowns = 0;
    const s = await sampleMacro({
      samples: 4,
      opsPerSample: 2,
      setup: async () => {
        setups++;
        await wait(20);
        return setups;
      },
      run: () => wait(10),
      teardown: () => {
        teardowns++;
      },
    });
    expect(s.samples).toBe(4);
    expect(setups).toBe(5); // one warm-up sample
    expect(teardowns).toBe(5);
    expect(s.median).toBeGreaterThanOrEqual(4);
    expect(s.median).toBeLessThan(15);
  });
});
