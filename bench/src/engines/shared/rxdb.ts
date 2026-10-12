import { createRxDatabase, type RxCollection } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import type { BenchDoc } from '../../core/data.ts';
import type { MemoryEngine } from '../../core/engine.ts';

type RxDoc = Omit<BenchDoc, 'id'> & { id: string };

const SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 12 },
    name: { type: 'string' },
    email: { type: 'string', maxLength: 64 },
    age: { type: 'integer', minimum: 0, maximum: 200, multipleOf: 1 },
    city: { type: 'string' },
    score: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'integer' },
  },
  required: ['id', 'email', 'age', 'city', 'score'],
  indexes: ['email', 'age'],
} as const;

let counter = 0;
const toIds = (docs: { id: string }[]) => docs.map((d) => Number(d.id));

export const rxdbMemory: MemoryEngine = {
  name: 'RxDB',
  packageName: 'rxdb',
  envs: ['node', 'browser'],
  sync: false,
  notes:
    'Memory storage, no dev-mode, no schema validator (the fastest setup). Indexes on email and age; string primary key (ids converted on insert). Live query through the query observable. Identical queries are answered from the RxDB query cache while the data does not change.',
  async create() {
    const db = await createRxDatabase({
      name: `bench${counter++}`,
      storage: getRxStorageMemory(),
    });
    const collections = await db.addCollections({ docs: { schema: SCHEMA } });
    const coll = collections.docs as unknown as RxCollection<RxDoc>;
    return {
      async insertMany(docs) {
        await coll.bulkInsert(docs.map((d) => ({ ...d, id: String(d.id) })));
      },
      async findEq(field, value) {
        return toIds(await coll.find({ selector: { [field]: value } }).exec());
      },
      async findRange(field, lo, hi) {
        return toIds(await coll.find({ selector: { [field]: { $gte: lo, $lte: hi } } }).exec());
      },
      async findCompound(city, minAge) {
        return toIds(await coll.find({ selector: { city, age: { $gt: minAge } } }).exec());
      },
      async sortLimit(limit) {
        return toIds(await coll.find({ selector: {}, sort: [{ score: 'desc' }], limit }).exec());
      },
      async updateOne(id, score) {
        const doc = await coll.findOne(String(id)).exec();
        if (!doc) {
          throw new Error(`no document ${id}`);
        }
        await doc.incrementalPatch({ score });
      },
      async removeOne(id) {
        await coll.bulkRemove([String(id)]);
      },
      async count() {
        return coll.count().exec();
      },
      liveQuery(city) {
        let latest = -1;
        const waiters: { n: number; resolve: () => void }[] = [];
        const subscription = coll.find({ selector: { city } }).$.subscribe((docs) => {
          latest = docs.length;
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].n === latest) {
              waiters[i].resolve();
              waiters.splice(i, 1);
            }
          }
        });
        return {
          waitForCount(n) {
            if (latest === n) {
              return;
            }
            return new Promise<void>((resolve) => waiters.push({ n, resolve }));
          },
          stop() {
            subscription.unsubscribe();
          },
        };
      },
      async close() {
        await db.remove();
      },
    };
  },
};
