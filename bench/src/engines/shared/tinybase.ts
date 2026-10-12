import {
  createIndexes,
  createQueries,
  createStore,
  type Row,
  type Select,
  type Where,
} from 'tinybase';
import type { BenchDoc } from '../../core/data.ts';
import type { MemoryEngine } from '../../core/engine.ts';

const TABLE = 'docs';
const toIds = (rowIds: string[]) => rowIds.map(Number);

type QueryBuilder = (keywords: { select: Select; where: Where }) => void;

export const tinybase: MemoryEngine = {
  name: 'TinyBase',
  packageName: 'tinybase',
  envs: ['node', 'browser'],
  sync: true,
  notes:
    'Store with indexes on email and age (range = union of age slices). Ad hoc queries are defined, read and deleted per call so they are not maintained afterwards; top scores use getSortedRowIds. One transaction per bulk insert.',
  create() {
    const store = createStore();
    const indexes = createIndexes(store);
    indexes.setIndexDefinition('email', TABLE, 'email');
    indexes.setIndexDefinition('age', TABLE, 'age');
    const queries = createQueries(store);
    const adHoc = (build: QueryBuilder) => {
      queries.setQueryDefinition('q', TABLE, build);
      const ids = toIds(queries.getResultRowIds('q'));
      queries.delQueryDefinition('q');
      return ids;
    };
    return {
      insertMany(docs: BenchDoc[]) {
        store.transaction(() => {
          for (const doc of docs) {
            store.setRow(TABLE, String(doc.id), doc as unknown as Row);
          }
        });
      },
      findEq(field, value) {
        if (field === 'email') {
          return toIds(indexes.getSliceRowIds('email', value));
        }
        return adHoc(({ select, where }) => {
          select('id');
          where('city', value);
        });
      },
      findRange(field, lo, hi) {
        if (field === 'age') {
          const ids: number[] = [];
          for (let age = lo; age <= hi; age++) {
            for (const rowId of indexes.getSliceRowIds('age', String(age))) {
              ids.push(Number(rowId));
            }
          }
          return ids;
        }
        return adHoc(({ select, where }) => {
          select('id');
          where((getCell) => {
            const score = getCell('score') as number;
            return score >= lo && score <= hi;
          });
        });
      },
      findCompound(city, minAge) {
        return adHoc(({ select, where }) => {
          select('id');
          where('city', city);
          where((getCell) => (getCell('age') as number) > minAge);
        });
      },
      sortLimit(limit) {
        return toIds(store.getSortedRowIds(TABLE, 'score', true, 0, limit));
      },
      updateOne(id, score) {
        store.setCell(TABLE, String(id), 'score', score);
      },
      removeOne(id) {
        store.delRow(TABLE, String(id));
      },
      count() {
        return store.getRowCount(TABLE);
      },
      liveQuery(city) {
        queries.setQueryDefinition('live', TABLE, ({ select, where }) => {
          select('id');
          where('city', city);
        });
        return {
          waitForCount(n) {
            const actual = queries.getResultRowCount('live');
            if (actual !== n) {
              throw new Error(`live query holds ${actual} documents, expected ${n}`);
            }
          },
          stop() {
            queries.delQueryDefinition('live');
          },
        };
      },
      close() {
        queries.destroy();
        indexes.destroy();
        store.delTables();
      },
    };
  },
};
