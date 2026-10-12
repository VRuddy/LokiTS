import type { BenchDoc } from '../../core/data.ts';
import type { LiveQuery, MemoryDb } from '../../core/engine.ts';

export interface LokiStyleCollection {
  insert(docs: BenchDoc[]): unknown;
  find(query: object): BenchDoc[];
  by(field: string, value: unknown): BenchDoc | undefined;
  chain(): {
    simplesort(
      field: string,
      options: { desc: boolean },
    ): { limit(n: number): { data(): BenchDoc[] } };
  };
  update(doc: BenchDoc): unknown;
  remove(doc: BenchDoc): unknown;
  count(): number;
  addDynamicView(name: string): { applyFind(query: object): unknown; count(): number };
  removeDynamicView(name: string): void;
}

export const LOKI_COLLECTION_OPTIONS = { unique: ['id', 'email'], indices: ['age'] };

const ids = (docs: BenchDoc[]) => docs.map((d) => d.id);

export function lokiStyleDb(coll: LokiStyleCollection): MemoryDb {
  const byId = (id: number) => {
    const doc = coll.by('id', id);
    if (!doc) {
      throw new Error(`no document ${id}`);
    }
    return doc;
  };
  return {
    insertMany(docs) {
      coll.insert(docs);
    },
    findEq(field, value) {
      if (field === 'email') {
        const doc = coll.by('email', value);
        return doc ? [doc.id] : [];
      }
      return ids(coll.find({ city: value }));
    },
    findRange(field, lo, hi) {
      return ids(coll.find({ [field]: { $between: [lo, hi] } }));
    },
    findCompound(city, minAge) {
      return ids(coll.find({ city, age: { $gt: minAge } }));
    },
    sortLimit(limit) {
      return ids(coll.chain().simplesort('score', { desc: true }).limit(limit).data());
    },
    updateOne(id, score) {
      const doc = byId(id);
      doc.score = score;
      coll.update(doc);
    },
    removeOne(id) {
      coll.remove(byId(id));
    },
    count() {
      return coll.count();
    },
    liveQuery(city): LiveQuery {
      const view = coll.addDynamicView('live');
      view.applyFind({ city });
      return {
        waitForCount(n) {
          const actual = view.count();
          if (actual !== n) {
            throw new Error(`live query holds ${actual} documents, expected ${n}`);
          }
        },
        stop() {
          coll.removeDynamicView('live');
        },
      };
    },
    close() {},
  };
}
