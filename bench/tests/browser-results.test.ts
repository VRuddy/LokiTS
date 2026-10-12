import { describe, expect, it } from 'vitest';
import { type BrowserFile, collectBrowserOutputs } from '../src/browser-results.ts';
import type { ChildOutput } from '../src/core/results.ts';

const output = (engine: string): ChildOutput => ({
  engine: { name: engine, packageName: engine, notes: '' },
  signatures: {},
  rows: [
    {
      family: 'persistence',
      scenario: 'write-all',
      size: 10,
      engine,
      env: 'chromium',
      median: 1,
      p75: 1,
      p99: 1,
      samples: 1,
    },
  ],
});

const expected = {
  browsers: ['chromium'],
  families: ['persistence' as const],
  engines: { memory: [], persistence: ['lokits-opfs', 'dexie-indexeddb', 'sqlite-opfs'] },
  sizes: [10],
};

describe('collectBrowserOutputs', () => {
  it('keeps the outputs that were written', () => {
    const files: BrowserFile[] = [
      {
        name: 'chromium-persistence-lokits-opfs.json',
        output: { ...output('LokiTS'), userAgent: 'UA' },
      },
    ];
    const groups = collectBrowserOutputs(files, expected);
    expect(groups.get('chromium-persistence')?.get('lokits-opfs')?.rows[0].median).toBe(1);
  });

  it('turns a missing or crashed engine into error rows', () => {
    const files: BrowserFile[] = [
      {
        name: 'chromium-persistence-lokits-opfs.json',
        output: { ...output('LokiTS'), userAgent: 'UA' },
      },
      {
        name: 'chromium-persistence-dexie-indexeddb.json',
        output: { crashed: 'boom', userAgent: 'UA' },
      },
    ];
    const group = collectBrowserOutputs(files, expected).get('chromium-persistence');
    const dexie = group?.get('dexie-indexeddb')?.rows ?? [];
    const sqlite = group?.get('sqlite-opfs')?.rows ?? [];
    expect(dexie).toHaveLength(3);
    expect(dexie.every((r) => r.error === 'crashed: boom' && r.env === 'chromium')).toBe(true);
    expect(sqlite.every((r) => r.error === 'crashed: no result (page crashed or timed out)')).toBe(
      true,
    );
  });
});
