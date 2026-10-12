import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crashRows } from './core/crash.ts';
import { QUERY_SCENARIOS } from './core/memory-scenarios.ts';
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
  // interleaved child processes per engine (A, B, A, B…)
  rounds?: number;
}

// Scenarios with a signature are checked against the reference; a missing signature fails closed.
export function flagMismatches(outputs: Map<string, ChildOutput>, reference: string): void {
  const expected = outputs.get(reference)?.signatures;
  const checked = new Set(
    QUERY_SCENARIOS.filter((s) => s.name !== 'update-one').map((s) => s.name),
  );
  for (const [name, output] of outputs) {
    if (name === reference) {
      continue;
    }
    for (const row of output.rows) {
      if (row.error !== undefined || !checked.has(row.scenario)) {
        continue;
      }
      const key = `${row.scenario}@${row.size}`;
      const mine = output.signatures[key];
      if (expected?.[key] === undefined || mine === undefined) {
        markError(row, 'result not verified');
      } else if (mine !== expected[key]) {
        markError(row, 'result differs from LokiTS');
      }
    }
  }
}

function markError(row: ResultRow, error: string): void {
  row.error = error;
  row.median = Number.NaN;
  row.p75 = Number.NaN;
  row.p99 = Number.NaN;
}

export function crashMessage(stderr: string, status: number | null): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Node.js v'));
  return (
    lines.find((line) => /^\w*Error\b|error:/.test(line)) ?? lines.at(-1) ?? `exit code ${status}`
  );
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
    return {
      engine: { name: engine, packageName: engine, notes: '' },
      signatures: {},
      rows: crashRows(
        opts.family,
        engine,
        'node',
        opts.sizes,
        crashMessage(result.stderr, result.status),
      ),
    };
  }
  return JSON.parse(readFileSync(out, 'utf8')) as ChildOutput;
}

// The JIT settles differently from one process to the next: keep the median round per scenario.
export function combineRounds(rounds: ChildOutput[]): ChildOutput {
  const groups = new Map<string, ResultRow[]>();
  for (const round of rounds) {
    for (const row of round.rows) {
      const key = `${row.scenario}|${row.size}|${row.storage ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }
  const rows: ResultRow[] = [];
  for (const group of groups.values()) {
    const ok = group.filter((r) => !r.error).sort((a, b) => a.median - b.median);
    rows.push(ok.length > 0 ? ok[Math.floor((ok.length - 1) / 2)] : group[0]);
  }
  return { ...rounds[0], rows };
}

export async function runNodeEngines(
  opts: NodeRunOptions,
): Promise<{ rows: ResultRow[]; engines: EngineMeta[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'lokits-bench-'));
  const rounds = new Map<string, ChildOutput[]>();
  try {
    for (let round = 1; round <= (opts.rounds ?? 1); round++) {
      for (const engine of opts.engines) {
        console.log(`[bench] ${opts.family} / ${engine} (round ${round})`);
        rounds.set(engine, [...(rounds.get(engine) ?? []), runChild(engine, opts, dir)]);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const outputs = new Map<string, ChildOutput>();
  for (const [engine, list] of rounds) {
    outputs.set(engine, combineRounds(list));
  }
  if (opts.family === 'memory') {
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
      rounds: { type: 'string', default: '3' },
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
      rounds: Number(values.rounds),
    });
    rows.push(...result.rows);
    engines.push(...result.engines);
  }
  console.log(`[bench] ${writeRunFile('node', rows, engines, { node: process.version })}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
