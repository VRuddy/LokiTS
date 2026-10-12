import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ResultRow } from './core/results.ts';
import { runNodeEngines } from './node.ts';

const BASELINE = fileURLToPath(new URL('../quick-baseline.json', import.meta.url));
const SIZE = 10_000;
const ROUNDS = 5;

export function computeRatios(rows: ResultRow[]): Record<string, number> {
  const ratios: Record<string, number> = {};
  for (const mine of rows.filter((r) => r.engine === 'LokiTS' && !r.error)) {
    const theirs = rows.find(
      (r) =>
        r.engine === 'lokijs' &&
        r.scenario === mine.scenario &&
        r.family === mine.family &&
        !r.error,
    );
    if (theirs) {
      ratios[mine.scenario] = mine.median / theirs.median;
    }
  }
  return ratios;
}

export function checkRatios(
  ratios: Record<string, number>,
  baseline: Record<string, number>,
  threshold: number,
): string[] {
  const failures: string[] = [];
  for (const scenario of Object.keys(baseline)) {
    if (!(scenario in ratios)) {
      failures.push(`${scenario}: no result`);
    }
  }
  for (const [scenario, ratio] of Object.entries(ratios)) {
    const reference = baseline[scenario];
    if (reference !== undefined && ratio > reference * threshold) {
      failures.push(
        `${scenario}: ratio ${ratio.toFixed(2)}, baseline ${reference.toFixed(2)} (limit ${threshold})`,
      );
    }
  }
  return failures;
}

async function main(): Promise<void> {
  // run-to-run noise reaches about 20 % on a laptop, so a tighter default raises false alarms
  const threshold = Number(process.env.BENCH_THRESHOLD ?? '1.3');
  const memory = await runNodeEngines({
    engines: ['lokits', 'lokijs'],
    family: 'memory',
    sizes: [SIZE],
    quick: true,
    rounds: ROUNDS,
  });
  const persistence = await runNodeEngines({
    engines: ['lokits-fs', 'lokijs-fs'],
    family: 'persistence',
    sizes: [SIZE],
    quick: true,
    scenarios: ['write-all'],
    rounds: ROUNDS,
  });
  const ratios = computeRatios([...memory.rows, ...persistence.rows]);
  for (const [scenario, ratio] of Object.entries(ratios)) {
    console.log(`${scenario.padEnd(20)} LokiTS / lokijs = ${ratio.toFixed(2)}`);
  }
  if (process.argv.includes('--update-baseline')) {
    writeFileSync(BASELINE, `${JSON.stringify(ratios, null, 2)}\n`);
    console.log(`[bench] baseline written to ${BASELINE}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const failures = checkRatios(ratios, baseline, threshold);
  if (failures.length > 0) {
    console.error(`[bench] regression:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
