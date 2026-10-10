import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, LokiMemoryAdapter, LokiPartitioningAdapter } from '../../src';
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

describe('Loki.open', () => {
  it('opens an existing database', async () => {
    const adapter = new LokiMemoryAdapter();
    const source = new Loki('o.db', { adapter });
    source.addCollection('users').insert({ name: 'odin' });
    await source.saveDatabase();

    const db = await Loki.open('o.db', { adapter });

    expect(db).toBeInstanceOf(Loki);
    expect(db.getCollection('users')?.findOne({ name: 'odin' })).toBeTruthy();
  });

  it('opens a missing database as an empty one', async () => {
    const db = await Loki.open('missing.db', { adapter: new LokiMemoryAdapter() });
    expect(db.listCollections()).toEqual([]);
  });

  it('rejects on corrupted data', async () => {
    const adapter = { loadDatabase: async () => '{corrupted' };
    await expect(Loki.open('bad.db', { adapter })).rejects.toBeInstanceOf(SyntaxError);
  });

  it('ignores autoload, which it replaces', async () => {
    let loads = 0;
    const adapter = {
      loadDatabase: async () => {
        loads++;
        return null;
      },
    };

    await Loki.open('o.db', { adapter, autoload: true });
    await flush(20);

    expect(loads).toBe(1);
  });

  describe('autosave', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('leaves no interval behind when the load rejects', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const adapter = { loadDatabase: async () => '{corrupted' };

      await expect(
        Loki.open('bad.db', { adapter, autosave: true, autosaveInterval: 5 }),
      ).rejects.toBeInstanceOf(SyntaxError);

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('starts autosave once the load has succeeded', async () => {
      const adapter = new LokiMemoryAdapter();

      const db = await Loki.open('auto.db', { adapter, autosave: true, autosaveInterval: 5 });
      try {
        expect(db.autosave).toBe(true);
        db.addCollection('users').insert({ name: 'odin' });
        await flush(20);

        expect(adapter.hashStore['auto.db'].savecount).toBeGreaterThanOrEqual(1);
      } finally {
        db.autosaveDisable();
      }
    });

    it('leaves the caller options untouched', async () => {
      const options = {
        adapter: new LokiMemoryAdapter(),
        autosave: true,
        autosaveInterval: 5,
        autoload: true,
      };
      const keys = Object.keys(options);

      const db = await Loki.open('opts.db', options);
      db.autosaveDisable();

      expect(Object.keys(options)).toEqual(keys);
      expect(options.autosave).toBe(true);
      expect(options.autoload).toBe(true);
    });
  });
});

describe('LokiMemoryAdapter', () => {
  it('returns promises', async () => {
    const adapter = new LokiMemoryAdapter();

    await adapter.saveDatabase('m.db', 'data');
    await expect(adapter.loadDatabase('m.db')).resolves.toBe('data');
    await adapter.deleteDatabase('m.db');
    await expect(adapter.loadDatabase('m.db')).resolves.toBeNull();
  });

  it('still calls back synchronously without asyncResponses', () => {
    const adapter = new LokiMemoryAdapter();
    const seen: unknown[] = [];

    adapter.saveDatabase('m.db', 'data', () => seen.push('saved'));
    adapter.loadDatabase('m.db', (value) => seen.push(value));

    expect(seen).toEqual(['saved', 'data']);
  });

  it('answers after asyncTimeout with asyncResponses', async () => {
    const adapter = new LokiMemoryAdapter({ asyncResponses: true, asyncTimeout: 5 });
    const seen: unknown[] = [];

    const saving = adapter.saveDatabase('m.db', 'data', () => seen.push('saved'));
    expect(seen).toEqual([]);

    await saving;
    expect(seen).toEqual(['saved']);
  });
});

describe('LokiPartitioningAdapter', () => {
  for (const paging of [false, true]) {
    it(`round-trips through promises (paging: ${paging})`, async () => {
      const inner = new LokiMemoryAdapter();
      const adapter = new LokiPartitioningAdapter(inner, { paging, pageSize: 50 });
      const db = new Loki('p.db', { adapter });
      const users = db.addCollection('users');
      for (let i = 0; i < 20; i++) {
        users.insert({ name: `user${i}` });
      }
      db.addCollection('empty');

      await db.saveDatabase();
      const reloaded = await Loki.open('p.db', {
        adapter: new LokiPartitioningAdapter(inner, { paging, pageSize: 50 }),
      });

      expect(reloaded.getCollection('users')?.count()).toBe(20);
      expect(reloaded.getCollection('empty')?.count()).toBe(0);
    });
  }

  it('stops at the first inner error', async () => {
    let saves = 0;
    const inner = {
      loadDatabase: async () => null,
      saveDatabase: async () => {
        saves++;
        throw new Error('quota');
      },
    };
    const db = new Loki('p.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.addCollection('a').insert({ x: 1 });
    db.addCollection('b').insert({ x: 2 });

    await expect(db.saveDatabase()).rejects.toThrow('quota');
    expect(saves).toBe(1);
  });

  it('stops at the first failing page when paging', async () => {
    const saved: string[] = [];
    const inner = {
      loadDatabase: async () => null,
      saveDatabase: async (key: string) => {
        saved.push(key);
        if (key !== 'p.db') {
          throw new Error('page quota');
        }
      },
    };
    const db = new Loki('p.db', {
      adapter: new LokiPartitioningAdapter(inner, { paging: true, pageSize: 50 }),
    });
    for (const name of ['a', 'b']) {
      const coll = db.addCollection(name);
      for (let i = 0; i < 5; i++) {
        coll.insert({ name: `${name}${i}` });
      }
    }

    await expect(db.saveDatabase()).rejects.toThrow('page quota');
    expect(saved).toEqual(['p.db', 'p.db.0.0']);
  });

  it('reports a non-string inner result as an error', async () => {
    const inner = { loadDatabase: async () => ({ not: 'a string' }) };
    await expect(new LokiPartitioningAdapter(inner).loadDatabase('p.db')).rejects.toThrow(
      'unexpected response from inner adapter',
    );
  });
});
