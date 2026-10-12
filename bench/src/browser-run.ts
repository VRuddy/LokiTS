import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WEBKIT_PROFILE } from '../vitest.browser.config.ts';
import type { ChildOutput, EngineMeta, ResultRow } from './core/results.ts';
import { flagMismatches, writeRunFile } from './node.ts';

type BrowserOutput = ChildOutput & { userAgent: string };

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
  console.error('[bench] some browser engines failed; their rows are missing from the results');
}

// files are named <browser>-<family>-<engine>.json; engine names may contain dashes
const groups = new Map<string, Map<string, BrowserOutput>>();
for (const file of readdirSync(TMP)) {
  const [browser, family, ...rest] = file.replace(/\.json$/, '').split('-');
  const output = JSON.parse(readFileSync(join(TMP, file), 'utf8')) as BrowserOutput;
  const key = `${browser}-${family}`;
  const group = groups.get(key) ?? new Map<string, BrowserOutput>();
  group.set(rest.join('-'), output);
  groups.set(key, group);
}

const rows: ResultRow[] = [];
const engines: EngineMeta[] = [];
const runtimes: Record<string, string> = {};
for (const [key, outputs] of groups) {
  if (key.endsWith('-memory') && outputs.has('lokits')) {
    flagMismatches(outputs, 'lokits');
  }
  for (const output of outputs.values()) {
    rows.push(...output.rows);
    engines.push(output.engine);
    runtimes[key.split('-')[0]] = output.userAgent;
  }
}
console.log(`[bench] ${writeRunFile('browser', rows, engines, runtimes)}`);
