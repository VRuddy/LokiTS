import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResultRow, RunFile } from './core/results.ts';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

export function formatDuration(ms: number): string {
  if (ms < 0.001) {
    return `${Number((ms * 1e6).toPrecision(3))} ns`;
  }
  if (ms < 1) {
    return `${Number((ms * 1e3).toPrecision(3))} µs`;
  }
  if (ms < 1000) {
    return `${Number(ms.toPrecision(3))} ms`;
  }
  return `${Number((ms / 1000).toPrecision(3))} s`;
}

const CACHE_MARK = ' †';
const CACHE_NOTE =
  '† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).';

// RxDB keeps the results of identical queries, so its in-memory query rows can measure a cache hit
const cached = (row: ResultRow) => row.engine === 'RxDB' && row.family === 'memory';

function label(row: ResultRow): string {
  const name = row.storage ? `${row.engine} (${row.storage})` : row.engine;
  return cached(row) ? `${name}${CACHE_MARK}` : name;
}

function formatRatio(ratio: number): string {
  return `×${ratio >= 0.01 ? ratio.toFixed(2) : Number(ratio.toPrecision(1))}`;
}

function table(rows: ResultRow[]): string {
  const reference = rows.find((r) => r.engine === 'LokiTS' && !r.error);
  const ok = rows.filter((r) => !r.error).sort((a, b) => a.median - b.median);
  const failed = rows.filter((r) => r.error);
  const header = reference ? `vs ${label(reference)}` : 'vs LokiTS';
  const lines = [`| Engine | Median | p75 | p99 | ${header} |`, '|---|---|---|---|---|'];
  for (const r of ok) {
    const ratio = reference ? formatRatio(r.median / reference.median) : '';
    lines.push(
      `| ${label(r)} | ${formatDuration(r.median)} | ${formatDuration(r.p75)} | ${formatDuration(r.p99)} | ${ratio} |`,
    );
  }
  for (const r of failed) {
    lines.push(`| ${label(r)} | n/a (error: ${r.error}) | | | |`);
  }
  if (rows.some(cached)) {
    lines.push('', CACHE_NOTE);
  }
  return lines.join('\n');
}

const METHOD = `## Method

- Every engine runs in its fastest idiomatic configuration; the choices are listed under Engines.
- Same indexes everywhere: \`id\` (primary or unique key), \`email\` (unique), \`age\`; \`city\` and \`score\` are not indexed.
- Before measuring, every query is checked against LokiTS: an engine that answers differently is shown as an error, never compared.
- Node: every engine runs in its own child process, in three interleaved rounds (A, B, A, B…); the round with the median result is kept, since the JIT settles differently from one process to the next. Browsers: one page per engine, one round.
- Queries are measured with [mitata](https://github.com/evanwashere/mitata); bulk operations and persistence use one untimed setup per sample and a discarded warm-up sample.
- Durations are per operation. \`remove-one\` and \`live-query\` are averaged over 1000 operations per sample.
- \`cold-start\` runs with a warm OS file cache.
- With 5 samples (100,000 documents), p99 is the slowest sample.`;

const LIMITS = `## Limits

- Durability differs between engines (see Engines): a faster write may give fewer guarantees.
- SQLite WASM persistence runs in a Worker (OPFS SAH pool VFS), the other browser engines on the main thread.
- RxDB is measured in memory only: its fast persistent storages are not free.
- RxDB caches query results while the data does not change: \`sort-limit\` (always the same query) and the city queries (50 values) are mostly answered from that cache.
- SQLite \`cold-start\` opens the file and answers from disk without loading the data; the other engines load everything into memory first.
- Numbers depend on the machine; compare ratios, not absolute times.`;

function runLine(run: RunFile): string {
  const runtimes = Object.entries(run.runtimes)
    .map(([name, version]) => `${name} ${version}`)
    .join(', ');
  const { cpu, cores, memoryGb, os } = run.machine;
  return `- ${run.kind}: ${run.date}, commit \`${run.commit}\`, ${cpu} (${cores} threads), ${memoryGb} GB, ${os}; ${runtimes}`;
}

export function renderReport(runs: RunFile[]): string {
  const out: string[] = ['# LokiTS benchmarks', ''];
  for (const run of runs) {
    out.push(runLine(run));
  }
  out.push(
    '',
    'Reproduce: `pnpm install && pnpm build && pnpm bench && pnpm bench:browser && pnpm bench:report`',
    '',
    METHOD,
    '',
    LIMITS,
    '',
  );
  const rows = runs.flatMap((r) => r.rows);
  for (const family of ['memory', 'persistence'] as const) {
    const familyRows = rows.filter((r) => r.family === family);
    if (familyRows.length === 0) {
      continue;
    }
    out.push(`## ${family === 'memory' ? 'In-memory operations' : 'Persistence'}`, '');
    const groups = new Map<string, ResultRow[]>();
    for (const r of familyRows) {
      const key = `${r.scenario}|${r.size}|${r.env}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, group] of groups) {
      const [scenario, size, env] = key.split('|');
      out.push(
        `### ${scenario}, ${Number(size).toLocaleString('en-US')} documents, ${env}`,
        '',
        table(group),
        '',
      );
    }
  }
  out.push('## Engines', '');
  const seen = new Set<string>();
  for (const engine of runs.flatMap((r) => r.engines)) {
    const key = `${engine.name}|${engine.storage ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      const storage = engine.storage ? ` (${engine.storage})` : '';
      const durability = engine.durability ? ` Durability: ${engine.durability}.` : '';
      out.push(`- **${engine.name}${storage}**: ${engine.notes}${durability}`);
    }
  }
  out.push('', '## Versions', '');
  const versions: Record<string, string> = Object.assign({}, ...runs.map((r) => r.versions));
  for (const [name, version] of Object.entries(versions)) {
    out.push(`- ${name} ${version}`);
  }
  return `${out.join('\n')}\n`;
}

function latest(kind: string): RunFile | undefined {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(`${kind}-`) && f.endsWith('.json'))
    .sort();
  const last = files.at(-1);
  return last ? (JSON.parse(readFileSync(join(RESULTS_DIR, last), 'utf8')) as RunFile) : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = [latest('node'), latest('browser')].filter((r): r is RunFile => r !== undefined);
  writeFileSync(join(RESULTS_DIR, 'REPORT.md'), renderReport(runs));
  console.log(`[bench] ${join(RESULTS_DIR, 'REPORT.md')}`);
}
