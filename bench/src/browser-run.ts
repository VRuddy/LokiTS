import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BROWSERS, WEBKIT_PROFILE } from '../vitest.browser.config.ts';
import { type BrowserFile, collectBrowserOutputs } from './browser-results.ts';
import type { EngineMeta, Family, ResultRow } from './core/results.ts';
import { flagMismatches, writeRunFile } from './node.ts';
import { BROWSER_MEMORY_ENGINES, BROWSER_PERSISTENT_ENGINES } from './registry/browser.ts';

const TMP = fileURLToPath(new URL('../.tmp/browser/', import.meta.url));
const CONFIG = fileURLToPath(new URL('../vitest.browser.config.ts', import.meta.url));

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '10000,100000' },
    family: { type: 'string', default: 'memory,persistence' },
    quick: { type: 'boolean', default: false },
  },
});

rmSync(TMP, { recursive: true, force: true });
// every run starts from empty browser storage
rmSync(WEBKIT_PROFILE, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', CONFIG], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_BENCH_SIZES: values.sizes,
    VITE_BENCH_FAMILY: values.family,
    VITE_BENCH_QUICK: values.quick ? '1' : '0',
  },
});
if (result.status !== 0) {
  console.error('[bench] some browser engines failed; they are reported as errors');
}

const families = values.family.split(',') as Family[];
const groups = collectBrowserOutputs(
  readdirSync(TMP).map((name) => ({
    name,
    output: JSON.parse(readFileSync(join(TMP, name), 'utf8')) as BrowserFile['output'],
  })),
  {
    browsers: BROWSERS,
    families,
    engines: {
      memory: Object.keys(BROWSER_MEMORY_ENGINES),
      persistence: Object.keys(BROWSER_PERSISTENT_ENGINES),
    },
    sizes: values.sizes.split(',').map(Number),
  },
);

const rows: ResultRow[] = [];
const engines: EngineMeta[] = [];
const runtimes: Record<string, string> = {};
for (const [key, outputs] of groups) {
  if (key.endsWith('-memory')) {
    flagMismatches(outputs, 'lokits');
  }
  for (const output of outputs.values()) {
    rows.push(...output.rows);
    engines.push(output.engine);
    if (output.userAgent) {
      runtimes[key.split('-')[0]] = output.userAgent;
    }
  }
}
console.log(`[bench] ${writeRunFile('browser', rows, engines, runtimes)}`);
