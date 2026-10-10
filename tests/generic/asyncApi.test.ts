import { describe, expect, it } from 'vitest';
import { Loki, LokiMemoryAdapter } from '../../src';
import { flush, ManualAdapter, TimedAdapter } from '../helpers/fake-adapters';

const failing = {
  loadDatabase: async () => {
    throw new Error('io');
  },
  saveDatabase: async () => {
    throw new Error('disk');
  },
  deleteDatabase: async () => {
    throw new Error('locked');
  },
};

describe('promise API', () => {
  it('awaits save, load and delete', async () => {
    const adapter = new LokiMemoryAdapter();
    const db = new Loki('a.db', { adapter });
    db.addCollection('c').insert({ a: 1 });

    await db.saveDatabase();
    const reloaded = new Loki('a.db', { adapter });
    await reloaded.loadDatabase();
    expect(reloaded.getCollection('c')?.count()).toBe(1);

    await reloaded.deleteDatabase();
    expect(adapter.hashStore['a.db']).toBeUndefined();
  });

  it('rejects without a callback', async () => {
    const db = new Loki('a.db', { adapter: failing });
    await expect(db.saveDatabase()).rejects.toThrow('disk');
    await expect(db.loadDatabase()).rejects.toThrow('io');
    await expect(db.deleteDatabase()).rejects.toThrow('locked');
  });

  it('never rejects with a callback, and passes the error to it', async () => {
    const db = new Loki('a.db', { adapter: failing });
    const errors: string[] = [];
    const record = (err?: Error) => errors.push(err?.message ?? 'none');

    await expect(db.saveDatabase(record)).resolves.toBeUndefined();
    await expect(db.loadDatabase({}, record)).resolves.toBeUndefined();
    await expect(db.deleteDatabase(record)).resolves.toBeUndefined();
    expect(errors).toEqual(['disk', 'io', 'locked']);
  });

  it('drains with a promise and accepts options first', async () => {
    const adapter = new ManualAdapter();
    const db = new Loki('a.db', { adapter });

    db.saveDatabase();
    const drained = db.throttledSaveDrain({
      recursiveWaitLimit: true,
      recursiveWaitLimitDuration: 1000,
    });
    adapter.saves[0].respond();

    await expect(drained).resolves.toBe(true);
    await expect(db.throttledSaveDrain()).resolves.toBe(true);
  });

  it('exposes throttledSavePending without serializing it', () => {
    const adapter = new ManualAdapter();
    const db = new Loki('a.db', { adapter });

    db.saveDatabase();

    expect(db.throttledSavePending).toBe(true);
    expect(Object.keys(JSON.parse(db.serialize()))).not.toContain('throttledSavePending');
    expect(Object.keys(JSON.parse(db.serialize()))).not.toContain('saveQueue');
  });

  it('plays saves requested during a load once it is done', async () => {
    const adapter = new TimedAdapter();
    const db = new Loki('a.db', { adapter });
    db.addCollection('c').insert({ a: 1 });

    const loading = db.loadDatabase();
    await flush(1);
    db.getCollection('c')?.insert({ a: 2 });
    const saving = db.saveDatabase();

    await loading;
    await saving;
    expect(adapter.log).toEqual(['load-start', 'load-end', 'save-start', 'save-end']);
  });

  it('drain does not trigger an extra save', async () => {
    const adapter = new ManualAdapter();
    const db = new Loki('a.db', { adapter });

    db.saveDatabase();
    const drained = db.throttledSaveDrain();
    adapter.saves[0].respond();

    await expect(drained).resolves.toBe(true);
    expect(adapter.saves).toHaveLength(1);
  });

  it('non-recursive drain answers a boolean, even after a failed save', async () => {
    const adapter = new ManualAdapter();
    const db = new Loki('a.db', { adapter });
    const answers: unknown[] = [];

    db.saveDatabase(() => {});
    const drained = db.throttledSaveDrain((ok) => answers.push(ok), { recursiveWait: false });
    adapter.saves[0].respond(new Error('disk'));

    await drained;
    expect(answers).toEqual([true]);
  });

  it('close calls its callback once', () => {
    const db = new Loki('a.db', { adapter: new LokiMemoryAdapter() });
    let calls = 0;

    db.close(() => calls++);
    db.close();

    expect(calls).toBe(1);
  });

  it('close saves pending changes and resolves after the save', async () => {
    const adapter = new LokiMemoryAdapter();
    const db = new Loki('a.db', { adapter, autosave: true, autosaveInterval: 60_000 });
    db.addCollection('c').insert({ a: 1 });

    await db.close();

    expect(adapter.hashStore['a.db'].savecount).toBe(1);
  });

  it('routes autosave errors to the warning event, once per failed save', async () => {
    const db = new Loki('a.db', { adapter: failing, autosave: true, autosaveInterval: 5 });
    const warnings: unknown[] = [];
    const first = new Promise<void>((resolve) =>
      db.on('warning', (warning) => {
        warnings.push(warning);
        db.autosaveDisable();
        resolve();
      }),
    );
    db.addCollection('c').insert({ a: 1 });

    await first;
    await flush(20);
    expect(warnings.map((warning) => (warning as Error).message)).toEqual(['disk']);
  });

  it('routes autoload errors without a callback to the warning event, once', async () => {
    const db = new Loki('a.db', { adapter: failing, autoload: true });
    const warnings: unknown[] = [];
    db.on('warning', (warning) => warnings.push(warning));

    await flush(20);
    expect(warnings.map((warning) => (warning as Error).message)).toEqual(['io']);
  });

  it('reports fire-and-forget failures as warnings, not unhandled rejections', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const db = new Loki('a.db', { adapter: failing });
      const warnings: string[] = [];
      db.on('warning', (warning) => warnings.push((warning as Error).message));

      db.saveDatabase();
      db.loadDatabase();
      db.deleteDatabase();
      await flush(20);

      expect(warnings.sort()).toEqual(['disk', 'io', 'locked']);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('still rejects for a caller who awaits without a callback', async () => {
    const db = new Loki('a.db', { adapter: failing });

    await expect(db.saveDatabase()).rejects.toThrow('disk');
  });
});
