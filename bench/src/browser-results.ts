import { crashRows } from './core/crash.ts';
import type { ChildOutput, Family } from './core/results.ts';

export type BrowserOutput = ChildOutput & { userAgent: string };

export interface BrowserFile {
  name: string;
  output: BrowserOutput | { crashed: string; userAgent: string };
}

export interface ExpectedRuns {
  browsers: string[];
  families: Family[];
  engines: Record<Family, string[]>;
  sizes: number[];
}

const NO_RESULT = 'no result (page crashed or timed out)';

// Groups outputs by "<browser>-<family>"; an engine that crashed or wrote nothing gets error rows.
export function collectBrowserOutputs(
  files: BrowserFile[],
  expected: ExpectedRuns,
): Map<string, Map<string, BrowserOutput>> {
  const written = new Map(files.map((f) => [f.name.replace(/\.json$/, ''), f.output]));
  const groups = new Map<string, Map<string, BrowserOutput>>();
  for (const browser of expected.browsers) {
    for (const family of expected.families) {
      const group = new Map<string, BrowserOutput>();
      for (const engine of expected.engines[family]) {
        const output = written.get(`${browser}-${family}-${engine}`);
        if (output && !('crashed' in output)) {
          group.set(engine, output);
          continue;
        }
        const message = output ? output.crashed : NO_RESULT;
        group.set(engine, {
          engine: { name: engine, packageName: engine, notes: '' },
          signatures: {},
          rows: crashRows(family, engine, browser, expected.sizes, message),
          userAgent: output?.userAgent ?? '',
        });
      }
      groups.set(`${browser}-${family}`, group);
    }
  }
  return groups;
}
