import { type BenchDoc, cloneDocs, generateDocs, makeParams, type Params } from './data.ts';
import type { LiveQuery, MaybePromise, MemoryDb, MemoryEngine } from './engine.ts';
import { measureOp, sampleMacro } from './measure.ts';
import { type ChildOutput, errorRow, type ResultRow } from './results.ts';
import { fnv1a, type Summary } from './stats.ts';

const MASK = 1023;
const LIVE_INSERTS = 1000;

export const QUERY_SCENARIOS: {
  name: string;
  run(db: MemoryDb, p: Params, i: number): MaybePromise<unknown>;
}[] = [
  { name: 'find-eq-indexed', run: (db, p, i) => db.findEq('email', p.emails[i & MASK]) },
  { name: 'find-eq-scan', run: (db, p, i) => db.findEq('city', p.cities[i & MASK]) },
  { name: 'find-range-indexed', run: (db, p, i) => db.findRange('age', ...p.ages[i & MASK]) },
  { name: 'find-range-scan', run: (db, p, i) => db.findRange('score', ...p.scores[i & MASK]) },
  { name: 'find-compound', run: (db, p, i) => db.findCompound(...p.compound[i & MASK]) },
  { name: 'sort-limit', run: (db) => db.sortLimit(20) },
  // last: it changes scores, which the other scenarios read
  { name: 'update-one', run: (db, p, i) => db.updateOne(p.ids[i & MASK], p.newScores[i & MASK]) },
];

export const MACRO_SCENARIOS = ['insert-bulk', 'remove-one', 'live-query'] as const;

export interface MemoryRunOptions {
  sizes: number[];
  env: string;
  quick: boolean;
  scenarios?: string[];
}

function macroSamples(size: number, quick: boolean): number {
  if (quick) {
    return 3;
  }
  return size <= 10_000 ? 15 : 5;
}

async function loaded(engine: MemoryEngine, docs: BenchDoc[]): Promise<MemoryDb> {
  const db = await engine.create();
  await db.insertMany(cloneDocs(docs));
  return db;
}

function liveDocs(size: number, city: string): BenchDoc[] {
  return generateDocs(LIVE_INSERTS, 99).map((d, k) => ({
    ...d,
    id: size + k,
    email: `live-${k}@example.com`,
    city,
  }));
}

async function startLive(db: MemoryDb, city: string): Promise<LiveQuery> {
  if (!db.liveQuery) {
    throw new Error('no live query');
  }
  return db.liveQuery(city);
}

async function runMacro(
  name: (typeof MACRO_SCENARIOS)[number],
  engine: MemoryEngine,
  docs: BenchDoc[],
  p: Params,
  samples: number,
): Promise<Summary | null> {
  if (name === 'insert-bulk') {
    return sampleMacro({
      samples,
      setup: async () => ({ db: await engine.create(), docs: cloneDocs(docs) }),
      run: (s) => s.db.insertMany(s.docs),
      teardown: (s) => s.db.close(),
    });
  }
  if (name === 'remove-one') {
    return sampleMacro({
      samples,
      opsPerSample: p.removeIds.length,
      setup: () => loaded(engine, docs),
      run: async (db) => {
        for (const id of p.removeIds) {
          if (engine.sync) {
            db.removeOne(id);
          } else {
            await db.removeOne(id);
          }
        }
      },
      teardown: (db) => db.close(),
    });
  }
  const probe = await engine.create();
  const hasLive = typeof probe.liveQuery === 'function';
  await probe.close();
  if (!hasLive) {
    return null;
  }
  const city = p.cities[0];
  const base = docs.filter((d) => d.city === city).length;
  const extra = liveDocs(docs.length, city);
  return sampleMacro({
    samples,
    opsPerSample: LIVE_INSERTS,
    setup: async () => {
      const db = await loaded(engine, docs);
      const live = await startLive(db, city);
      await live.waitForCount(base);
      return { db, live, batch: cloneDocs(extra) };
    },
    run: async ({ db, live, batch }) => {
      for (let k = 0; k < batch.length; k++) {
        if (engine.sync) {
          db.insertMany([batch[k]]);
          live.waitForCount(base + k + 1);
        } else {
          await db.insertMany([batch[k]]);
          await live.waitForCount(base + k + 1);
        }
      }
    },
    teardown: async ({ db, live }) => {
      await live.stop();
      await db.close();
    },
  });
}

export async function memorySignatures(
  engine: MemoryEngine,
  size: number,
): Promise<Record<string, string>> {
  const docs = generateDocs(size);
  const p = makeParams(docs);
  const db = await loaded(engine, docs);
  const out: Record<string, string> = {};
  for (const scenario of QUERY_SCENARIOS) {
    if (scenario.name === 'update-one') {
      continue;
    }
    const ids = (await scenario.run(db, p, 0)) as number[];
    const ordered = scenario.name === 'sort-limit' ? ids : [...ids].sort((a, b) => a - b);
    out[`${scenario.name}@${size}`] = fnv1a(ordered.join(','));
  }
  await db.close();
  return out;
}

export async function runMemory(
  engine: MemoryEngine,
  opts: MemoryRunOptions,
): Promise<ChildOutput> {
  const wanted = (name: string) => !opts.scenarios || opts.scenarios.includes(name);
  const rows: ResultRow[] = [];
  let signatures: Record<string, string> = {};
  for (const size of opts.sizes) {
    const base = { family: 'memory' as const, size, engine: engine.name, env: opts.env };
    const docs = generateDocs(size);
    const p = makeParams(docs);
    try {
      signatures = { ...signatures, ...(await memorySignatures(engine, size)) };
    } catch {
      // the error shows up in the rows below
    }
    const queries = QUERY_SCENARIOS.filter((s) => wanted(s.name));
    if (queries.length > 0) {
      let db: MemoryDb | undefined;
      try {
        db = await loaded(engine, docs);
      } catch (error) {
        for (const s of queries) {
          rows.push(errorRow({ ...base, scenario: s.name }, error));
        }
      }
      if (db) {
        const target = db;
        for (const s of queries) {
          try {
            let i = 0;
            const summary = await measureOp(() => s.run(target, p, i++), engine.sync, opts.quick);
            rows.push({ ...base, scenario: s.name, ...summary });
          } catch (error) {
            rows.push(errorRow({ ...base, scenario: s.name }, error));
          }
        }
        await target.close();
      }
    }
    for (const name of MACRO_SCENARIOS.filter(wanted)) {
      try {
        const summary = await runMacro(name, engine, docs, p, macroSamples(size, opts.quick));
        if (summary) {
          rows.push({ ...base, scenario: name, ...summary });
        }
      } catch (error) {
        rows.push(errorRow({ ...base, scenario: name }, error));
      }
    }
  }
  return {
    rows,
    signatures,
    engine: { name: engine.name, packageName: engine.packageName, notes: engine.notes },
  };
}
