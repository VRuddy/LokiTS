import { describe, expect, it } from 'vitest';
import {
  flush,
  ManualAdapter,
  ManualIncrementalAdapter,
  TimedAdapter,
} from '../helpers/fake-adapters';
import { loki } from '../helpers/loki';

const newDb = (adapter: unknown, options: Record<string, unknown> = {}) =>
  new loki('behavior.db', { adapter, ...options });

describe('save queue', () => {
  it('folds saves requested during a save into one follow-up save', async () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);
    db.addCollection('c').insert({ a: 1 });
    const calls: string[] = [];

    db.saveDatabase((err: unknown) => calls.push(`first:${err ?? ''}`));
    db.saveDatabase((err: unknown) => calls.push(`second:${err ?? ''}`));
    db.saveDatabase((err: unknown) => calls.push(`third:${err ?? ''}`));
    expect(adapter.saves).toHaveLength(1);

    adapter.saves[0].respond();
    // the follow-up save starts once the first one has settled, a microtask later
    await flush(1);
    expect(adapter.saves).toHaveLength(2);
    await flush();
    expect(calls).toEqual(['first:']);

    adapter.saves[1].respond();
    await flush();
    expect(calls).toEqual(['first:', 'second:', 'third:']);
  });

  it('saves on every call when throttling is off', () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter, { throttledSaves: false });

    db.saveDatabase();
    db.saveDatabase();

    expect(adapter.saves).toHaveLength(2);
  });

  it('passes a save error to every waiting callback', async () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);
    const errors: unknown[] = [];

    db.saveDatabase((err: unknown) => errors.push(err));
    adapter.saves[0].respond(new Error('disk full'));
    await flush();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('disk full');
  });

  it('waits for pending saves before loading', async () => {
    const adapter = new TimedAdapter();
    const db = newDb(adapter);
    db.addCollection('c').insert({ a: 1 });

    db.saveDatabase();
    await new Promise<void>((resolve) => db.loadDatabase({}, () => resolve()));

    const loadStart = adapter.log.indexOf('load-start');
    expect(loadStart).toBe(adapter.log.lastIndexOf('save-end') + 1);
    expect(adapter.log.slice(loadStart)).toEqual(['load-start', 'load-end']);
  });
});

describe('adapter modes', () => {
  it('normal mode sends the serialized database and clears dirty flags at once', () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);
    db.addCollection('c').insert({ a: 1 });

    db.saveDatabase();

    expect(typeof adapter.saves[0].data).toBe('string');
    expect(JSON.parse(adapter.saves[0].data as string).collections[0].data[0].a).toBe(1);
    expect(db.autosaveDirty()).toBe(false);
  });

  it('reference mode exports a copy of the database and clears dirty flags', async () => {
    const adapter = new ManualAdapter('reference');
    const db = newDb(adapter);
    db.addCollection('c').insert({ a: 1 });
    let done = false;

    db.saveDatabase(() => {
      done = true;
    });
    expect(adapter.exports).toHaveLength(1);
    expect(adapter.exports[0].db).not.toBe(db);
    expect(adapter.exports[0].db.getCollection('c').count()).toBe(1);

    adapter.exports[0].respond();
    await flush();
    expect(done).toBe(true);
    expect(db.autosaveDirty()).toBe(false);
  });

  it('incremental mode clears dirty ids on success and restores them on failure', async () => {
    const adapter = new ManualIncrementalAdapter();
    const db = newDb(adapter);
    const coll = db.addCollection('c');
    coll.insert({ a: 1 });
    expect(coll.dirtyIds).toEqual([1]);

    db.saveDatabase();
    expect(coll.dirtyIds).toEqual([]);
    adapter.saves[0].respond(new Error('quota'));
    await flush();
    expect(coll.dirtyIds).toEqual([1]);
    expect(coll.dirty).toBe(true);

    db.saveDatabase();
    adapter.saves[1].respond();
    await flush();
    expect(coll.dirtyIds).toEqual([]);
  });
});

describe('loading', () => {
  it('treats a missing database as empty and emits loaded', async () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);
    const events: string[] = [];
    db.on('loaded', (message: string) => events.push(message));

    const result = new Promise<unknown>((resolve) => db.loadDatabase({}, resolve));
    adapter.loads[0].respond(null);

    expect(await result).toBeFalsy();
    expect(events).toEqual(['empty database behavior.db loaded']);
  });

  it('loads a serialized database', async () => {
    const source = new loki('behavior.db');
    source.addCollection('users').insert({ name: 'odin' });
    const adapter = new ManualAdapter();
    const db = newDb(adapter);

    const result = new Promise<unknown>((resolve) => db.loadDatabase({}, resolve));
    adapter.loads[0].respond(source.serialize());

    expect(await result).toBeFalsy();
    expect(db.getCollection('users').findOne({ name: 'odin' })).toBeTruthy();
  });

  it('passes adapter errors and invalid JSON to the callback', async () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);

    const adapterError = new Promise<unknown>((resolve) => db.loadDatabase({}, resolve));
    adapter.loads[0].respond(new Error('io'));
    expect(((await adapterError) as Error).message).toBe('io');

    const parseError = new Promise<unknown>((resolve) => db.loadDatabase({}, resolve));
    await flush();
    adapter.loads[1].respond('{not json');
    expect(await parseError).toBeInstanceOf(Error);
  });
});

describe('deleting', () => {
  it('passes the adapter error to the callback', async () => {
    const adapter = new ManualAdapter();
    const db = newDb(adapter);

    const result = new Promise<unknown>((resolve) => db.deleteDatabase(resolve));
    adapter.deletes[0].respond(new Error('locked'));

    expect(((await result) as Error).message).toBe('locked');
  });
});
