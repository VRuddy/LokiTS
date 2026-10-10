import { describe, expect, it } from 'vitest';
import { Loki } from '../../src';
import {
  deleteFromAdapter,
  loadFromAdapter,
  saveToAdapter,
} from '../../src/persistence/persistence';
import { ManualAdapter, ManualIncrementalAdapter } from '../helpers/fake-adapters';

const dbWith = (adapter: unknown) => new Loki('p.db', { adapter: adapter as any });

describe('loadFromAdapter', () => {
  it('loads strings, objects and empty results, and emits loaded', async () => {
    const source = new Loki('p.db');
    source.addCollection('c').insert({ a: 1 });
    const messages: unknown[] = [];

    const fromString = dbWith({ loadDatabase: async () => source.serialize() });
    fromString.on('loaded', (m) => messages.push(m));
    await loadFromAdapter(fromString);
    expect(fromString.getCollection('c')?.count()).toBe(1);

    const fromObject = dbWith({ loadDatabase: async () => JSON.parse(source.serialize()) });
    await loadFromAdapter(fromObject);
    expect(fromObject.getCollection('c')?.count()).toBe(1);

    const empty = dbWith({ loadDatabase: async () => null });
    empty.on('loaded', (m) => messages.push(m));
    await loadFromAdapter(empty);

    expect(messages).toEqual(['database p.db loaded', 'empty database p.db loaded']);
  });

  it('rejects on adapter errors, invalid JSON and unexpected values', async () => {
    await expect(
      loadFromAdapter(
        dbWith({
          loadDatabase: async () => {
            throw new Error('io');
          },
        }),
      ),
    ).rejects.toThrow('io');
    await expect(
      loadFromAdapter(dbWith({ loadDatabase: async () => '{bad' })),
    ).rejects.toBeInstanceOf(SyntaxError);
    await expect(loadFromAdapter(dbWith({ loadDatabase: async () => 42 }))).rejects.toThrow(
      'unexpected adapter response : 42',
    );
  });

  it('rejects without an adapter', async () => {
    const db = new Loki('p.db');
    db.persistenceAdapter = null;
    await expect(loadFromAdapter(db)).rejects.toThrow('persistenceAdapter not configured');
  });
});

describe('saveToAdapter', () => {
  it('normal mode clears dirty flags and calls the adapter synchronously', async () => {
    const adapter = new ManualAdapter();
    const db = dbWith(adapter);
    db.addCollection('c').insert({ a: 1 });

    const saving = saveToAdapter(db);
    expect(adapter.saves).toHaveLength(1);
    expect(db.autosaveDirty()).toBe(false);

    adapter.saves[0].respond();
    await saving;
  });

  it('normal mode restores dirty flags on failure', async () => {
    const adapter = new ManualAdapter();
    const db = dbWith(adapter);
    db.addCollection('dirty').insert({ a: 1 });
    db.addCollection('clean');
    db.getCollection('clean')!.dirty = false;

    const saving = saveToAdapter(db);
    adapter.saves[0].respond(new Error('disk'));

    await expect(saving).rejects.toThrow('disk');
    expect(db.getCollection('dirty')?.dirty).toBe(true);
    expect(db.getCollection('clean')?.dirty).toBe(false);
  });

  it('reference mode exports a copy and keeps dirty flags on failure', async () => {
    const adapter = new ManualAdapter('reference');
    const db = dbWith(adapter);
    db.addCollection('c').insert({ a: 1 });

    const saving = saveToAdapter(db);
    expect(adapter.exports[0].db).not.toBe(db);
    adapter.exports[0].respond(new Error('quota'));

    await expect(saving).rejects.toThrow('quota');
    expect(db.autosaveDirty()).toBe(true);
  });

  it('reference mode clears dirty flags on success', async () => {
    const adapter = new ManualAdapter('reference');
    const db = dbWith(adapter);
    db.addCollection('c').insert({ a: 1 });

    const saving = saveToAdapter(db);
    adapter.exports[0].respond();

    await saving;
    expect(db.autosaveDirty()).toBe(false);
  });

  it('incremental mode rolls dirty ids back on failure', async () => {
    const adapter = new ManualIncrementalAdapter();
    const db = dbWith(adapter);
    const coll = db.addCollection('c');
    coll.insert({ a: 1 });

    const saving = saveToAdapter(db);
    expect(coll.dirtyIds).toEqual([]);
    expect(db.ignoreAutosave).toBe(false);
    adapter.saves[0].respond(new Error('quota'));

    await expect(saving).rejects.toThrow('quota');
    expect(coll.dirtyIds).toEqual([1]);
  });

  it('incremental rollback survives a collection added during the save', async () => {
    const adapter = new ManualIncrementalAdapter();
    const db = dbWith(adapter);
    const first = db.addCollection('first');
    first.insert({ a: 1 });

    const saving = saveToAdapter(db);
    const added = db.addCollection('added');
    added.insert({ b: 1 });
    adapter.saves[0].respond(new Error('quota'));

    await expect(saving).rejects.toThrow('quota');
    expect(first.dirtyIds).toEqual([1]);
    expect(added.dirtyIds).toEqual([1]);
  });

  it('incremental rollback survives a collection removed during the save', async () => {
    const adapter = new ManualIncrementalAdapter();
    const db = dbWith(adapter);
    const first = db.addCollection('first');
    const second = db.addCollection('second');
    first.insert([{ a: 1 }, { a: 2 }]);
    second.insert({ b: 1 });

    const saving = saveToAdapter(db);
    db.removeCollection('first');
    adapter.saves[0].respond(new Error('quota'));

    await expect(saving).rejects.toThrow('quota');
    expect(second.dirtyIds).toEqual([1]);
  });
  it('incremental mode rejects when getLokiCopy is called twice', async () => {
    const db = dbWith({
      mode: 'incremental',
      loadDatabase: async () => null,
      saveDatabase: async (_name: string, getLokiCopy: () => unknown) => {
        getLokiCopy();
        getLokiCopy();
      },
    });

    await expect(saveToAdapter(db)).rejects.toThrow('getLokiCopy called more than once');
  });
});

describe('deleteFromAdapter', () => {
  it('deletes through the adapter and accepts { success: true }', async () => {
    const adapter = new ManualAdapter();
    const deleting = deleteFromAdapter(dbWith(adapter));

    expect(adapter.deletes[0].name).toBe('p.db');
    adapter.deletes[0].respond({ success: true });
    await expect(deleting).resolves.toBeUndefined();
  });
});
