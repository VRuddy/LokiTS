import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Loki, LokiFsAdapter, LokiMemoryAdapter, LokiPartitioningAdapter } from '../../src';

/** Memory adapter that fails the n-th write (save or delete), counting from 1; 0 never fails. */
class FlakyMemoryAdapter extends LokiMemoryAdapter {
  writes = 0;
  failAt = 0;

  override saveDatabase(dbname: string, dbstring: string, callback?: () => void): Promise<void> {
    this.writes++;
    if (this.writes === this.failAt) {
      return Promise.reject(new Error(`write ${this.writes} failed`));
    }
    return super.saveDatabase(dbname, dbstring, callback);
  }
}

const manifestOf = (inner: LokiMemoryAdapter, name = 'g.db') =>
  JSON.parse(inner.hashStore[name].value).lokiPartitions;

async function populated(inner: LokiMemoryAdapter) {
  const db = new Loki('g.db', { adapter: new LokiPartitioningAdapter(inner) });
  db.addCollection('a').insert([{ x: 1 }, { x: 2 }]);
  db.addCollection('b').insert({ y: 1 });
  await db.saveDatabase();
  return db;
}

describe('LokiPartitioningAdapter generations', () => {
  it('commits a manifest that lists every collection file by name', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);

    const manifest = manifestOf(inner);
    expect(manifest.version).toBe(1);
    expect(manifest.generation).toBe(1);
    expect(manifest.collections.map((c: { name: string }) => c.name)).toEqual(['a', 'b']);
    for (const entry of manifest.collections) {
      expect(entry.files[0]).toMatch(/^g\.db\.\d\.g1-[a-z0-9]+$/);
      expect(inner.hashStore[entry.files[0]]).toBeDefined();
    }
  });

  it('round-trips through Loki.open', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });

    expect(reopened.getCollection('a')?.count()).toBe(2);
    expect(reopened.getCollection('b')?.findOne({ y: 1 })).toBeTruthy();
  });

  it('rewrites only dirty collections and removes their previous files', async () => {
    const inner = new LokiMemoryAdapter();
    const db = await populated(inner);
    const before = manifestOf(inner);

    db.getCollection('a')?.insert({ x: 3 });
    await db.saveDatabase();
    const after = manifestOf(inner);

    expect(after.generation).toBe(2);
    expect(after.collections[1].files).toEqual(before.collections[1].files);
    expect(after.collections[0].files[0]).toMatch(/\.g2-/);
    expect(inner.hashStore[before.collections[0].files[0]]).toBeUndefined();
  });

  it('keeps files matched by name when a collection is removed', async () => {
    const inner = new LokiMemoryAdapter();
    const db = await populated(inner);
    const bFiles = manifestOf(inner).collections[1].files;

    db.removeCollection('a');
    await db.saveDatabase();

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.listCollections().map((c) => c.name)).toEqual(['b']);
    expect(reopened.getCollection('b')?.count()).toBe(1);
    expect(manifestOf(inner).collections[0].files).toEqual(bFiles);
  });

  it('survives a failure at every step of the commit', async () => {
    for (let failAt = 1; failAt <= 3; failAt++) {
      const inner = new FlakyMemoryAdapter();
      const db = await populated(inner);
      db.getCollection('a')?.insert({ x: 3 });
      db.getCollection('b')?.insert({ y: 2 });

      inner.writes = 0;
      inner.failAt = failAt;
      await expect(db.saveDatabase()).rejects.toThrow(`write ${failAt} failed`);
      inner.failAt = 0;

      const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
      expect(reopened.getCollection('a')?.count()).toBe(2);
      expect(reopened.getCollection('b')?.count()).toBe(1);
    }
  });

  it('reports a listed file that is missing', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);
    delete inner.hashStore[manifestOf(inner).collections[0].files[0]];

    await expect(
      Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) }),
    ).rejects.toThrow(/is missing/);
  });

  it('pages collections when paging is on', async () => {
    const inner = new LokiMemoryAdapter();
    const db = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { paging: true, pageSize: 30 }),
    });
    db.addCollection('a').insert(Array.from({ length: 10 }, (_, x) => ({ x })));
    await db.saveDatabase();

    expect(manifestOf(inner).collections[0].files.length).toBeGreaterThan(1);
    const reopened = await Loki.open('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { paging: true, pageSize: 30 }),
    });
    expect(reopened.getCollection('a')?.count()).toBe(10);
  });

  it('converts a historical database on its first save and removes the old partitions', async () => {
    const inner = new LokiMemoryAdapter();
    const legacy = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { generations: false }),
    });
    legacy.addCollection('a').insert({ x: 1 });
    await legacy.saveDatabase();
    expect(inner.hashStore['g.db.0']).toBeDefined();

    const db = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.getCollection('a')?.insert({ x: 2 });
    await db.saveDatabase();

    expect(manifestOf(inner).collections[0].name).toBe('a');
    expect(inner.hashStore['g.db.0']).toBeUndefined();
    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.getCollection('a')?.count()).toBe(2);
  });

  it('deletes a database saved with generations', async () => {
    const inner = new LokiMemoryAdapter();
    const db = await populated(inner);

    await db.deleteDatabase();

    expect(Object.keys(inner.hashStore)).toEqual([]);
  });

  it('cleans up and deletes through listing without touching files it did not write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loki-generations-'));
    try {
      const name = join(dir, 'app.db');
      const db = new Loki(name, { adapter: new LokiPartitioningAdapter(new LokiFsAdapter()) });
      db.addCollection('users').insert({ name: 'odin' });
      await db.saveDatabase();
      const userFiles = ['app.db.0', 'app.db.2024', 'app.db.5.0', 'app.db.7'];
      for (const user of userFiles) {
        await writeFile(join(dir, user), 'user data');
      }
      // an orphan of an interrupted save, found only by listing
      await writeFile(join(dir, 'app.db.0.g9-dead'), '');

      db.getCollection('users')?.insert({ name: 'thor' });
      await db.saveDatabase();
      const committed = JSON.parse(await readFile(name, 'utf8')).lokiPartitions.collections[0]
        .files[0] as string;
      expect((await readdir(dir)).sort()).toEqual(
        ['app.db', ...userFiles, committed.slice(dir.length + 1)].sort(),
      );

      await db.deleteDatabase();

      expect((await readdir(dir)).sort()).toEqual(userFiles);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rewrites every collection when switching back to the historical layout', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);
    const historical = { generations: false };

    const db = await Loki.open('g.db', {
      adapter: new LokiPartitioningAdapter(inner, historical),
    });
    db.getCollection('a')?.insert({ x: 3 });
    await db.saveDatabase();

    const reopened = await Loki.open('g.db', {
      adapter: new LokiPartitioningAdapter(inner, historical),
    });
    expect(
      reopened
        .getCollection('a')
        ?.find()
        .map((doc) => doc.x),
    ).toEqual([1, 2, 3]);
    expect(
      reopened
        .getCollection('b')
        ?.find()
        .map((doc) => doc.y),
    ).toEqual([1]);
  });

  it('survives a failure at every step of the switch back to the historical layout', async () => {
    for (let failAt = 1; failAt <= 3; failAt++) {
      const inner = new FlakyMemoryAdapter();
      await populated(inner);
      const historical = { generations: false };
      const db = await Loki.open('g.db', {
        adapter: new LokiPartitioningAdapter(inner, historical),
      });
      db.getCollection('a')?.insert({ x: 3 });

      inner.writes = 0;
      inner.failAt = failAt;
      await expect(db.saveDatabase()).rejects.toThrow(`write ${failAt} failed`);
      inner.failAt = 0;

      const reopened = await Loki.open('g.db', {
        adapter: new LokiPartitioningAdapter(inner, historical),
      });
      expect(reopened.getCollection('a')?.count()).toBe(2);
      expect(reopened.getCollection('b')?.count()).toBe(1);
    }
  });

  it('removes the generation files once switched back to the historical layout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loki-generations-'));
    try {
      const name = join(dir, 'app.db');
      const db = new Loki(name, { adapter: new LokiPartitioningAdapter(new LokiFsAdapter()) });
      db.addCollection('a').insert({ x: 1 });
      db.addCollection('b').insert({ y: 1 });
      await db.saveDatabase();

      const historical = await Loki.open(name, {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter(), { generations: false }),
      });
      historical.getCollection('b')?.insert({ y: 2 });
      await historical.saveDatabase();

      expect((await readdir(dir)).sort()).toEqual(['app.db', 'app.db.0', 'app.db.1']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads each page of a paged historical database once when loading it', async () => {
    const inner = new LokiMemoryAdapter();
    const options = { paging: true, pageSize: 20 };
    const legacy = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { ...options, generations: false }),
    });
    legacy.addCollection('a').insert([{ x: 1 }, { x: 2 }, { x: 3 }]);
    await legacy.saveDatabase();
    const loads: string[] = [];
    const load = inner.loadDatabase.bind(inner);
    inner.loadDatabase = (key, callback) => {
      loads.push(key);
      return load(key, callback);
    };

    await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner, options) });

    const pageLoads = loads.filter((key) => key.startsWith('g.db.0.'));
    expect(pageLoads.length).toBeGreaterThan(1);
    expect(new Set(pageLoads).size).toBe(pageLoads.length);
  });

  it('writes the historical format with generations: false', async () => {
    const inner = new LokiMemoryAdapter();
    const db = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { generations: false }),
    });
    db.addCollection('a').insert({ x: 1 });
    await db.saveDatabase();

    expect(Object.keys(inner.hashStore).sort()).toEqual(['g.db', 'g.db.0']);
    expect(JSON.parse(inner.hashStore['g.db'].value).lokiPartitions).toBeUndefined();
  });
});
