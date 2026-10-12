import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ChildOutput, EngineMeta, Family, ResultRow, RunFile } from './core/results.ts';
import { gitCommit, machineInfo, packageVersions } from './machine.ts';
import { NODE_MEMORY_ENGINES, NODE_PERSISTENT_ENGINES } from './registry/node.ts';

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));
export const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

export interface NodeRunOptions {
  engines: string[];
  family: Family;
  sizes: number[];
  quick: boolean;
  scenarios?: string[];
}

export function flagMismatches(outputs: Map<string, ChildOutput>, reference: string): void {
  const expected = outputs.get(reference)?.signatures ?? {};
  for (const [name, output] of outputs) {
    if (name === reference) {
      continue;
    }
    for (const row of output.rows) {
      const key = `${row.scenario}@${row.size}`;
      const differs =
        key in expected && key in output.signatures && output.signatures[key] !== expected[key];
      if (row.error === undefined && differs) {
        row.error = 'result differs from LokiTS';
        row.median = Number.NaN;
        row.p75 = Number.NaN;
        row.p99 = Number.NaN;
      }
    }
  }
}

function runChild(engine: string, opts: NodeRunOptions, dir: string): ChildOutput {
  const out = join(dir, `${engine}-${opts.family}.json`);
  const args = [
    '--expose-gc',
    '--disable-warning=ExperimentalWarning',
    CHILD,
    `--engine=${engine}`,
    `--family=${opts.family}`,
    `--sizes=${opts.sizes.join(',')}`,
    `--out=${out}`,
  ];
  if (opts.scenarios) {
    args.push(`--scenarios=${opts.scenarios.join(',')}`);
  }
  if (opts.quick) {
    args.push('--quick');
  }
  const result = spawnSync(process.execPath, args, {
    stdio: ['ignore', 'inherit', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const message = result.stderr.trim().split('\n').at(-1) ?? `exit code ${result.status}`;
    return {
      engine: { name: engine, packageName: engine, notes: '' },
      signatures: {},
      rows: [
        {
          family: opts.family,
          scenario: '*',
          size: opts.sizes[0],
          engine,
          env: 'node',
          median: Number.NaN,
          p75: Number.NaN,
          p99: Number.NaN,
          samples: 0,
          error: `crashed: ${message}`,
        },
      ],
    };
  }
  return JSON.parse(readFileSync(out, 'utf8')) as ChildOutput;
}

export async function runNodeEngines(
  opts: NodeRunOptions,
): Promise<{ rows: ResultRow[]; engines: EngineMeta[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'lokits-bench-'));
  const outputs = new Map<string, ChildOutput>();
  try {
    for (const engine of opts.engines) {
      console.log(`[bench] ${opts.family} / ${engine}`);
      outputs.set(engine, runChild(engine, opts, dir));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (opts.family === 'memory' && outputs.has('lokits')) {
    flagMismatches(outputs, 'lokits');
  }
  return {
    rows: [...outputs.values()].flatMap((o) => o.rows),
    engines: [...outputs.values()].map((o) => o.engine),
  };
}

export function writeRunFile(
  kind: RunFile['kind'],
  rows: ResultRow[],
  engines: EngineMeta[],
  runtimes: Record<string, string>,
): string {
  const date = new Date().toISOString();
  const file: RunFile = {
    kind,
    date,
    commit: gitCommit(),
    machine: machineInfo(),
    runtimes,
    versions: packageVersions(),
    engines,
    rows,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${kind}-${date.slice(0, 19).replaceAll(':', '-')}.json`);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      engines: { type: 'string' },
      family: { type: 'string', default: 'all' },
      sizes: { type: 'string', default: '10000,100000' },
      scenarios: { type: 'string' },
      quick: { type: 'boolean', default: false },
    },
  });
  const families: Family[] =
    values.family === 'all' ? ['memory', 'persistence'] : [values.family as Family];
  const sizes = values.sizes.split(',').map(Number);
  const rows: ResultRow[] = [];
  const engines: EngineMeta[] = [];
  for (const family of families) {
    const registry = family === 'memory' ? NODE_MEMORY_ENGINES : NODE_PERSISTENT_ENGINES;
    const names = values.engines?.split(',').filter((n) => n in registry) ?? Object.keys(registry);
    const result = await runNodeEngines({
      engines: names,
      family,
      sizes,
      quick: values.quick,
      scenarios: values.scenarios?.split(','),
    });
    rows.push(...result.rows);
    engines.push(...result.engines);
  }
  console.log(`[bench] ${writeRunFile('node', rows, engines, { node: process.version })}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
