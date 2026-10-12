import { test } from 'vitest';
import { commands, server } from 'vitest/browser';
import { runMemory } from '../src/core/memory-scenarios.ts';
import { runPersistence } from '../src/core/persistence-scenarios.ts';
import type { ChildOutput, Family } from '../src/core/results.ts';
import { BROWSER_MEMORY_ENGINES, BROWSER_PERSISTENT_ENGINES } from '../src/registry/browser.ts';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const sizes = (env.VITE_BENCH_SIZES ?? '10000,100000').split(',').map(Number);
const quick = env.VITE_BENCH_QUICK === '1';
const families = (env.VITE_BENCH_FAMILY ?? 'memory,persistence').split(',');

export function benchEngine(family: Family, name: string): void {
  test.skipIf(!families.includes(family))(`${family} ${name}`, async () => {
    const browser = server.browser;
    const file = `bench/.tmp/browser/${browser}-${family}-${name}.json`;
    let output: ChildOutput | { crashed: string };
    try {
      output =
        family === 'memory'
          ? await runMemory(await BROWSER_MEMORY_ENGINES[name](), { sizes, env: browser, quick })
          : await runPersistence(await BROWSER_PERSISTENT_ENGINES[name](), {
              sizes,
              env: browser,
              quick,
              location: (size) => `lokits-bench-${name}-${size}`,
            });
    } catch (error) {
      output = { crashed: error instanceof Error ? error.message : String(error) };
    }
    await commands.writeFile(file, JSON.stringify({ ...output, userAgent: navigator.userAgent }));
  });
}
