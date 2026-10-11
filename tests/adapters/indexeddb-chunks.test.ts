import { describe, expect, it } from 'vitest';
import { Loki } from '../../src';
import {
  assembleLoki,
  type ChunkSink,
  classifyKey,
  getChunk,
  parseChunk,
  type StoredChunk,
  versionIdOf,
  writeChunks,
} from '../../src/adapters/indexeddb/chunks';

const recorder = () => {
  const puts: StoredChunk[] = [];
  const deletes: string[] = [];
  const sink: ChunkSink = { put: (chunk) => puts.push(chunk), delete: (key) => deletes.push(key) };
  return { puts, deletes, sink };
};

function dbWith(count: number, name = 'users') {
  const db = new Loki('chunks.db');
  const coll = db.addCollection<{ n: number }>(name);
  for (let n = 0; n < count; n++) {
    coll.insert({ n });
  }
  return db;
}

describe('IndexedDB chunk keys', () => {
  it('classifies the keys of the stored format', () => {
    expect(classifyKey('loki')).toEqual({ type: 'loki' });
    expect(classifyKey('users.metadata')).toEqual({ type: 'metadata', collection: 'users' });
    expect(classifyKey('users.chunk.12')).toEqual({ type: 'data', collection: 'users', index: 12 });
  });

  it('classifies keys of collections with dots', () => {
    expect(classifyKey('users.v2.metadata')).toEqual({ type: 'metadata', collection: 'users.v2' });
    expect(classifyKey('a.metadata.chunk.3')).toEqual({
      type: 'data',
      collection: 'a.metadata',
      index: 3,
    });
    expect(classifyKey('a.metadata.metadata')).toEqual({
      type: 'metadata',
      collection: 'a.metadata',
    });
  });

  it('rejects unknown keys', () => {
    expect(() => classifyKey('stray')).toThrow('Corrupted database - unknown chunk stray');
  });
});

describe('getChunk', () => {
  it('returns the documents of one $loki range', () => {
    const coll = dbWith(250).getCollection('users') as any;
    expect(getChunk(coll, 0).map((doc: any) => doc.$loki)).toEqual(
      Array.from({ length: 99 }, (_, i) => i + 1),
    );
    expect(getChunk(coll, 1)).toHaveLength(100);
    expect(getChunk(coll, 2).map((doc: any) => doc.$loki)).toEqual(
      Array.from({ length: 51 }, (_, i) => i + 200),
    );
    expect(getChunk(coll, 3)).toEqual([]);
  });

  it('skips removed documents', () => {
    const db = dbWith(10);
    const coll = db.getCollection('users') as any;
    coll.remove(coll.get(5));
    expect(getChunk(coll, 0).map((doc: any) => doc.$loki)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10]);
  });
});

describe('writeChunks', () => {
  it('writes every chunk, metadata and loki on a full save', () => {
    const copy = dbWith(150).copy({ removeNonSerializable: true }) as any;
    const { puts, deletes, sink } = recorder();
    const versionId = writeChunks(sink, copy, { keys: [] }, {});
    expect(puts.map((chunk) => chunk.key)).toEqual([
      'users.chunk.0',
      'users.chunk.1',
      'users.metadata',
      'loki',
    ]);
    expect(deletes).toEqual([]);
    const loki = JSON.parse(puts[3].value);
    expect(loki.idbVersionId).toBe(versionId);
    expect(loki.collections).toEqual([{ name: 'users' }]);
    const metadata = JSON.parse(puts[2].value);
    expect(metadata.data).toEqual([]);
    expect(typeof metadata.idbVersionId).toBe('string');
  });

  it('writes only dirty chunks on an incremental save', () => {
    const db = dbWith(250);
    for (const coll of db.collections) {
      coll.dirty = false;
      coll.dirtyIds = [];
    }
    const users = db.getCollection<{ n: number }>('users')!;
    users.isIncremental = true;
    const doc = users.get(150)!;
    doc.n = -1;
    users.update(doc);
    const { puts, sink } = recorder();
    writeChunks(sink, db.copy({ removeNonSerializable: true }) as any, null, {});
    expect(puts.map((chunk) => chunk.key)).toEqual(['users.chunk.1', 'users.metadata', 'loki']);
  });

  it('deletes keys that no longer belong to the database on a full save', () => {
    const copy = dbWith(50).copy({ removeNonSerializable: true }) as any;
    const { deletes, sink } = recorder();
    writeChunks(
      sink,
      copy,
      {
        keys: [
          'loki',
          'users.metadata',
          'users.chunk.0',
          'users.chunk.4',
          'old.metadata',
          'old.chunk.0',
        ],
      },
      {},
    );
    expect(deletes.sort()).toEqual(['old.chunk.0', 'old.metadata', 'users.chunk.4']);
  });

  it('passes chunks through serializeChunk', () => {
    const copy = dbWith(2).copy({ removeNonSerializable: true }) as any;
    const { puts, sink } = recorder();
    writeChunks(
      sink,
      copy,
      { keys: [] },
      {
        serializeChunk: (name, chunk) => chunk.map((doc: any) => [name, doc.n]),
      },
    );
    expect(JSON.parse(puts[0].value)).toEqual([
      ['users', 0],
      ['users', 1],
    ]);
  });
});

describe('assembleLoki', () => {
  function storedChunks(db: Loki): StoredChunk[] {
    const { puts, sink } = recorder();
    writeChunks(sink, db.copy({ removeNonSerializable: true }) as any, { keys: [] }, {});
    return puts;
  }

  it('rebuilds collections in $loki order whatever the chunk order', () => {
    const chunks = storedChunks(dbWith(350)).reverse();
    const loki = assembleLoki(
      chunks.map((chunk) => parseChunk(chunk, undefined, [])),
      {},
    );
    const data = loki.collections[0].getData();
    expect(data).toHaveLength(350);
    expect(data.map((doc: any) => doc.$loki)).toEqual(Array.from({ length: 350 }, (_, i) => i + 1));
  });

  it('defers parsing of lazy collections until getData', () => {
    const chunks = storedChunks(dbWith(3));
    const parsed = chunks.map((chunk) => parseChunk(chunk, undefined, ['users']));
    expect(typeof parsed.find((chunk) => chunk.kind.type === 'data')?.value).toBe('string');
    const loki = assembleLoki(parsed, { lazyCollections: ['users'] });
    expect(loki.collections[0].getData()).toHaveLength(3);
  });

  it('reads the version id of the stored loki chunk', () => {
    expect(versionIdOf(undefined)).toBeNull();
    expect(versionIdOf({ key: 'loki', value: '{"idbVersionId":"abc"}' })).toBe('abc');
    expect(versionIdOf({ key: 'loki', value: 'not json' })).toBeNull();
  });

  it('rejects a database without its loki chunk', () => {
    const chunks = storedChunks(dbWith(1)).filter((chunk) => chunk.key !== 'loki');
    expect(() =>
      assembleLoki(
        chunks.map((chunk) => parseChunk(chunk, undefined, [])),
        {},
      ),
    ).toThrow('Corrupted database - missing database metadata');
  });
});
