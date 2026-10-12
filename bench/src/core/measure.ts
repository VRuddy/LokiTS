import { do_not_optimize, measure } from 'mitata';
import type { MaybePromise } from './engine.ts';
import { type Summary, summarize } from './stats.ts';

const NS_PER_MS = 1e6;
// mitata defaults to 642 ms of CPU time per benchmark; the quick mode trades precision for time
const QUICK_CPU_TIME_NS = 150 * NS_PER_MS;

function collectGarbage(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

export async function measureOp(
  fn: () => unknown,
  sync: boolean,
  quick: boolean,
): Promise<Summary> {
  const options = quick ? { min_cpu_time: QUICK_CPU_TIME_NS } : {};
  const stats = sync
    ? await measure(() => {
        do_not_optimize(fn());
      }, options)
    : await measure(async () => {
        do_not_optimize(await fn());
      }, options);
  return summarize(stats.samples.map((ns) => ns / NS_PER_MS));
}

export interface MacroOptions<S> {
  samples: number;
  opsPerSample?: number;
  setup: () => MaybePromise<S>;
  run: (state: S) => MaybePromise<void>;
  teardown?: (state: S) => MaybePromise<void>;
}

// One untimed setup per sample, the first sample is a discarded warm-up.
export async function sampleMacro<S>(opts: MacroOptions<S>): Promise<Summary> {
  const ops = opts.opsPerSample ?? 1;
  const values: number[] = [];
  for (let i = 0; i <= opts.samples; i++) {
    const state = await opts.setup();
    collectGarbage();
    const start = performance.now();
    const pending = opts.run(state);
    if (pending instanceof Promise) {
      await pending;
    }
    const elapsed = performance.now() - start;
    await opts.teardown?.(state);
    if (i > 0) {
      values.push(elapsed / ops);
    }
  }
  return summarize(values);
}
