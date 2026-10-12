import { cloneDocs, generateDocs, makeParams } from './data.ts';
import type { PersistentDb, PersistentEngine } from './engine.ts';
import { sampleMacro } from './measure.ts';
import { type ChildOutput, errorRow, type ResultRow } from './results.ts';
import type { Summary } from './stats.ts';

export const PERSISTENCE_SCENARIOS = ['write-all', 'write-delta', 'cold-start'] as const;
const DELTA = 100;

export interface PersistenceRunOptions {
  sizes: number[];
  env: string;
  quick: boolean;
  scenarios?: string[];
  location: (size: number) => string;
}

function samplesFor(size: number, quick: boolean): number {
  if (quick) {
    return 4;
  }
  return size <= 10_000 ? 10 : 5;
}

async function createPersisted(
  engine: PersistentEngine,
  location: string,
  size: number,
): Promise<void> {
  await engine.destroy(location);
  const db = await engine.open(location);
  await db.insertMany(generateDocs(size));
  await db.persist();
  await db.close();
}

async function measureScenario(
  name: (typeof PERSISTENCE_SCENARIOS)[number],
  engine: PersistentEngine,
  location: string,
  size: number,
  samples: number,
): Promise<Summary> {
  const docs = generateDocs(size);
  const p = makeParams(docs);
  if (name === 'write-all') {
    return sampleMacro({
      samples,
      setup: async () => {
        await engine.destroy(location);
        return { db: await engine.open(location), batch: cloneDocs(docs) };
      },
      run: async ({ db, batch }) => {
        await db.insertMany(batch);
        await db.persist();
      },
      teardown: ({ db }) => db.close(),
    });
  }
  await createPersisted(engine, location, size);
  if (name === 'write-delta') {
    let round = 0;
    return sampleMacro({
      samples,
      setup: () => engine.open(location),
      run: async (db) => {
        await db.updateScores(p.ids.slice(0, DELTA), round++ / 1000);
        await db.persist();
      },
      teardown: (db) => db.close(),
    });
  }
  let opened: PersistentDb | undefined;
  let i = 0;
  return sampleMacro({
    samples,
    setup: () => undefined,
    run: async () => {
      opened = await engine.open(location);
      const found = await opened.findEq('email', p.emails[i++ & 1023]);
      if (found.length !== 1) {
        throw new Error(`cold start found ${found.length} documents`);
      }
    },
    teardown: () => opened?.close(),
  });
}

export async function runPersistence(
  engine: PersistentEngine,
  opts: PersistenceRunOptions,
): Promise<ChildOutput> {
  const rows: ResultRow[] = [];
  for (const size of opts.sizes) {
    const location = opts.location(size);
    for (const scenario of PERSISTENCE_SCENARIOS) {
      if (opts.scenarios && !opts.scenarios.includes(scenario)) {
        continue;
      }
      const base = {
        family: 'persistence' as const,
        scenario,
        size,
        engine: engine.name,
        storage: engine.storage,
        env: opts.env,
      };
      try {
        const summary = await measureScenario(
          scenario,
          engine,
          location,
          size,
          samplesFor(size, opts.quick),
        );
        rows.push({ ...base, ...summary });
      } catch (error) {
        rows.push(errorRow(base, error));
      }
    }
    await engine.destroy(location).catch(() => undefined);
  }
  return {
    rows,
    signatures: {},
    engine: {
      name: engine.name,
      packageName: engine.packageName,
      storage: engine.storage,
      durability: engine.durability,
      notes: engine.notes,
    },
  };
}
