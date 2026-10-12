import { describe, expect, it } from 'vitest';
import type { ResultRow, RunFile } from '../src/core/results.ts';
import { renderReport } from '../src/report.ts';

const row = (
  engine: string,
  env: string,
  median: number,
  extra: Partial<ResultRow> = {},
): ResultRow => ({
  family: 'memory',
  scenario: 'find-eq-scan',
  size: 10_000,
  engine,
  env,
  median,
  p75: median,
  p99: median,
  samples: 10,
  ...extra,
});

const run = (rows: ResultRow[]): RunFile => ({
  kind: 'node',
  date: '2026-10-12T10:00:00.000Z',
  commit: 'abc1234',
  machine: { cpu: 'Test CPU', cores: 8, memoryGb: 16, os: 'linux' },
  runtimes: { node: 'v22.23.3' },
  versions: { lokijs: '1.5.12' },
  engines: [{ name: 'LokiTS', packageName: '@lokits/core', notes: 'n' }],
  rows,
});

describe('renderReport', () => {
  it('writes one table per scenario, size and environment, with ratios to LokiTS', () => {
    const md = renderReport([
      run([row('LokiTS', 'node', 0.2), row('lokijs', 'node', 0.3), row('LokiTS', 'chromium', 0.5)]),
    ]);
    expect(md).toContain('### find-eq-scan, 10,000 documents, node');
    expect(md).toContain('### find-eq-scan, 10,000 documents, chromium');
    expect(md).toMatch(/\| lokijs \|[^\n]*\| ×1\.50 \|/);
    expect(md).toContain('Test CPU');
    expect(md).toContain('abc1234');
  });

  it('shows errors instead of numbers', () => {
    const md = renderReport([
      run([row('LokiTS', 'node', 0.2), row('LokiDB', 'node', Number.NaN, { error: 'boom' })]),
    ]);
    expect(md).toMatch(/\| LokiDB \| n\/a \(error: boom\) \|/);
  });

  it('formats durations with a readable unit', () => {
    const md = renderReport([run([row('LokiTS', 'node', 0.000_42), row('lokijs', 'node', 12.5)])]);
    expect(md).toContain('420 ns');
    expect(md).toContain('12.5 ms');
  });

  it('marks RxDB in-memory rows as possibly cached', () => {
    const md = renderReport([run([row('LokiTS', 'node', 1), row('RxDB', 'node', 0.5)])]);
    expect(md).toMatch(/\| RxDB † \|/);
    expect(md).toContain('† RxDB may answer repeated queries from its query cache');
  });

  it('keeps tiny ratios readable', () => {
    const md = renderReport([run([row('LokiTS', 'node', 100), row('RxDB', 'node', 0.004)])]);
    expect(md).toContain('×0.00004');
  });

  it('describes interleaved rounds in the method', () => {
    expect(renderReport([run([row('LokiTS', 'node', 1)])])).toContain('interleaved rounds');
  });
});
