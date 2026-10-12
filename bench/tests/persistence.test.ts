import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateDocs } from '../src/core/data.ts';
import type { PersistentEngine } from '../src/core/engine.ts';
import { PERSISTENCE_SCENARIOS, runPersistence } from '../src/core/persistence-scenarios.ts';
import {
  lokidbFs,
  lokijsFs,
  lokitsFs,
  lokitsFsStructured,
  sqliteFile,
  tinybaseFile,
} from '../src/engines/node/persistent.ts';

const ENGINES: PersistentEngine[] = [
  lokitsFs,
  lokitsFsStructured,
  lokijsFs,
  lokidbFs,
  tinybaseFile,
  sqliteFile,
];
const root = mkdtempSync(join(tmpdir(), 'bench-persist-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.each(ENGINES)('$name ($storage)', (engine) => {
  const dir = join(root, `${engine.name}-${engine.storage}`);

  it('round-trips documents and updates', async () => {
    await engine.destroy(dir);
    const docs = generateDocs(200);
    const db = await engine.open(dir);
    await db.insertMany(docs);
    await db.persist();
    await db.close();
    const reopened = await engine.open(dir);
    expect(await reopened.findEq('email', docs[5].email)).toEqual([5]);
    await reopened.updateScores([1, 2], 0.5);
    await reopened.persist();
    await reopened.close();
    await engine.destroy(dir);
  });

  it('runs every scenario', async () => {
    const out = await runPersistence(engine, {
      sizes: [200],
      env: 'node',
      quick: true,
      location: () => dir,
    });
    expect(out.rows.map((r) => r.scenario)).toEqual([...PERSISTENCE_SCENARIOS]);
    expect(out.rows.every((r) => r.error === undefined && r.storage === engine.storage)).toBe(true);
  }, 60_000);
});
