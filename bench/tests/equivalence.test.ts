import { describe, expect, it } from 'vitest';
import { cloneDocs, generateDocs, makeParams } from '../src/core/data.ts';
import type { MemoryEngine } from '../src/core/engine.ts';
import { sqliteNode } from '../src/engines/node/sqlite.ts';
import { lokidb } from '../src/engines/shared/lokidb.ts';
import { lokijs } from '../src/engines/shared/lokijs.ts';
import { lokits } from '../src/engines/shared/lokits.ts';
import { rxdbMemory } from '../src/engines/shared/rxdb.ts';
import { tinybase } from '../src/engines/shared/tinybase.ts';

const ENGINES: MemoryEngine[] = [lokits, lokijs, lokidb, tinybase, rxdbMemory, sqliteNode];
const docs = generateDocs(300);
const p = makeParams(docs);
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

async function answers(engine: MemoryEngine) {
  const db = await engine.create();
  await db.insertMany(cloneDocs(docs));
  const out = {
    count: await db.count(),
    email: sorted(await db.findEq('email', p.emails[0])),
    city: sorted(await db.findEq('city', p.cities[0])),
    age: sorted(await db.findRange('age', ...p.ages[0])),
    score: sorted(await db.findRange('score', ...p.scores[0])),
    compound: sorted(await db.findCompound(...p.compound[0])),
    top: await db.sortLimit(20),
    afterUpdate: [] as number[],
    afterRemove: 0,
  };
  await db.updateOne(p.ids[0], 2);
  out.afterUpdate = await db.sortLimit(1);
  await db.removeOne(p.removeIds[0]);
  out.afterRemove = await db.count();
  if (db.liveQuery) {
    const live = await db.liveQuery('city-0');
    const before = docs.filter((d) => d.city === 'city-0' && d.id !== p.removeIds[0]).length;
    await live.waitForCount(before);
    await db.insertMany([{ ...docs[1], id: 10_000, email: 'live@example.com', city: 'city-0' }]);
    await live.waitForCount(before + 1);
    await live.stop();
  }
  await db.close();
  return out;
}

describe('engines answer the same', () => {
  it('reference answers are not trivial', async () => {
    const ref = await answers(lokits);
    expect(ref.count).toBe(300);
    expect(ref.email).toHaveLength(1);
    expect(ref.city.length).toBeGreaterThan(0);
    expect(ref.age.length).toBeGreaterThan(0);
    expect(ref.top).toHaveLength(20);
    expect(ref.afterUpdate).toEqual([p.ids[0]]);
    expect(ref.afterRemove).toBe(299);
  });

  for (const engine of ENGINES) {
    it(engine.name, async () => {
      expect(await answers(engine)).toEqual(await answers(lokits));
    });
  }
});
