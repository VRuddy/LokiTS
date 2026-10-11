import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

/** Memory adapter that holds back the answer of the next load of `gateKey` until `release()`. */
class GatedMemoryAdapter extends LokiMemoryAdapter {
  gateKey: string | undefined;
  private opened: Promise<void> = Promise.resolve();
  release: () => void = () => {};

  hold(key: string): void {
    this.gateKey = key;
    this.opened = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  override async loadDatabase(dbname: string): Promise<string | null> {
    // read now, answer later: the answer is what the storage held at the time of the read
    const value = await super.loadDatabase(dbname);
    if (dbname === this.gateKey) {
      this.gateKey = undefined;
      await this.opened;
    }
    return value;
  }
}

const manifestOf = (inner: LokiMemoryAdapter, name = 'g.db') =>
  JSON.parse(inner.hashStore[name].value).lokiPartitions;

/** Manifest file names are relative to the database name. */
const keyOf = (file: string, dbname = 'g.db') => `${dbname}.${file}`;

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
      expect(entry.files[0]).toMatch(/^\d\.g1-[a-z0-9]+$/);
      expect(inner.hashStore[keyOf(entry.files[0])]).toBeDefined();
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
    expect(inner.hashStore[keyOf(before.collections[0].files[0])]).toBeUndefined();
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

  it('saves the documents of a collection renamed over a removed one', async () => {
    const inner = new LokiMemoryAdapter();
    const db = new Loki('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.addCollection('users').insert({ v: 'old' });
    await db.saveDatabase();
    db.addCollection('users_new').insert({ v: 'new' });
    await db.saveDatabase();

    db.removeCollection('users');
    db.renameCollection('users_new', 'users');
    await db.saveDatabase();

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(
      reopened
        .getCollection('users')
        ?.find()
        .map((doc) => doc.v),
    ).toEqual(['new']);
  });

  it('saves collections swapped through renames', async () => {
    const inner = new LokiMemoryAdapter();
    const db = await populated(inner);

    db.renameCollection('a', 'tmp');
    db.renameCollection('b', 'a');
    db.renameCollection('tmp', 'b');
    await db.saveDatabase();

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    const a = reopened.getCollection('a');
    const b = reopened.getCollection('b');
    expect(a?.find().map((doc) => doc.y)).toEqual([1]);
    expect(a?.maxId).toBe(1);
    expect(b?.find().map((doc) => doc.x)).toEqual([1, 2]);
    expect(b?.maxId).toBe(2);
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

  it('serializes overlapping saves of the same database', async () => {
    const inner = new LokiMemoryAdapter({ asyncResponses: true, asyncTimeout: 5 });
    const db = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner),
      throttledSaves: false,
    });
    db.addCollection('a').insert({ x: 1 });
    db.addCollection('b').insert({ y: 1 });
    await db.saveDatabase();

    db.getCollection('a')?.insert({ x: 2 });
    db.getCollection('b')?.insert({ y: 2 });
    const first = db.saveDatabase();
    db.getCollection('a')?.insert({ x: 3 });
    const second = db.saveDatabase();
    await Promise.all([first, second]);

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.getCollection('a')?.count()).toBe(3);
    expect(reopened.getCollection('b')?.count()).toBe(2);
  });

  it('serializes a save and a delete of the same database', async () => {
    const inner = new LokiMemoryAdapter({ asyncResponses: true, asyncTimeout: 5 });
    const db = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner),
      throttledSaves: false,
    });
    db.addCollection('a').insert({ x: 1 });
    await db.saveDatabase();

    db.getCollection('a')?.insert({ x: 2 });
    const saving = db.saveDatabase();
    const deleting = db.deleteDatabase();
    await Promise.all([saving, deleting]);

    expect(Object.keys(inner.hashStore)).toEqual([]);
  });

  it('orders a load with the saves of the same database', async () => {
    const inner = new GatedMemoryAdapter();
    const adapter = new LokiPartitioningAdapter(inner);
    const db = new Loki('g.db', { adapter, throttledSaves: false });
    db.addCollection('a').insert({ x: 1 });
    db.addCollection('b').insert({ y: 1 });
    await db.saveDatabase();

    // the load reads the last file of generation 1, and answers once a save has committed generation 2
    inner.hold(keyOf(manifestOf(inner).collections[1].files[0]));
    const loading = new Loki('g.db', { adapter, throttledSaves: false }).loadDatabase();
    db.getCollection('a')?.insert({ x: 2 });
    db.getCollection('b')?.insert({ y: 2 });
    const saving = db.saveDatabase();
    await new Promise((resolve) => setTimeout(resolve, 20));
    inner.release();
    await Promise.all([loading, saving]);

    db.getCollection('a')?.insert({ x: 3 });
    await db.saveDatabase();

    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.getCollection('a')?.count()).toBe(3);
    expect(reopened.getCollection('b')?.count()).toBe(2);
  });

  it('runs the next save after a failed one', async () => {
    const inner = new FlakyMemoryAdapter();
    const db = await populated(inner);
    db.getCollection('a')?.insert({ x: 3 });
    inner.writes = 0;
    inner.failAt = 1;

    const failing = db.saveDatabase();
    const next = db.saveDatabase();

    await expect(failing).rejects.toThrow('write 1 failed');
    await expect(next).resolves.toBeUndefined();
    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.getCollection('a')?.count()).toBe(3);
  });

  it('still resolves the save when the cleanup cannot delete', async () => {
    const inner = new LokiMemoryAdapter();
    const db = await populated(inner);
    const before = manifestOf(inner);
    inner.deleteDatabase = () => Promise.reject(new Error('delete failed'));

    db.getCollection('a')?.insert({ x: 3 });
    await expect(db.saveDatabase()).resolves.toBeUndefined();

    expect(inner.hashStore[keyOf(before.collections[0].files[0])]).toBeDefined();
    const reopened = await Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(reopened.getCollection('a')?.count()).toBe(3);
  });

  it('reads the container once across historical saves', async () => {
    const inner = new LokiMemoryAdapter();
    const loads: string[] = [];
    const load = inner.loadDatabase.bind(inner);
    inner.loadDatabase = (key, callback) => {
      loads.push(key);
      return load(key, callback);
    };
    const db = new Loki('g.db', {
      adapter: new LokiPartitioningAdapter(inner, { generations: false }),
    });
    db.addCollection('a').insert({ x: 1 });

    await db.saveDatabase();
    db.getCollection('a')?.insert({ x: 2 });
    await db.saveDatabase();

    expect(loads.filter((key) => key === 'g.db')).toHaveLength(1);
  });

  it('reports a listed file that is missing', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);
    delete inner.hashStore[keyOf(manifestOf(inner).collections[0].files[0])];

    await expect(
      Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) }),
    ).rejects.toThrow(/is missing/);
  });

  it('leaves the original intact when a copy of the database is saved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loki-generations-'));
    try {
      const original = join(root, 'original');
      const copy = join(root, 'copy');
      await mkdir(original);
      const db = new Loki(join(original, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      db.addCollection('a').insert({ x: 1 });
      db.addCollection('b').insert({ y: 1 });
      await db.saveDatabase();
      const files = (await readdir(original)).sort();
      await cp(original, copy, { recursive: true });

      const copied = await Loki.open(join(copy, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      copied.getCollection('a')?.insert({ x: 2 });
      await copied.saveDatabase();

      expect((await readdir(original)).sort()).toEqual(files);
      const reopened = await Loki.open(join(original, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      expect(reopened.getCollection('a')?.count()).toBe(1);
      expect(reopened.getCollection('b')?.count()).toBe(1);
      const reopenedCopy = await Loki.open(join(copy, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      expect(reopenedCopy.getCollection('a')?.count()).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads a database whose directory was moved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loki-generations-'));
    try {
      const before = join(root, 'before');
      const after = join(root, 'after');
      await mkdir(before);
      const db = new Loki(join(before, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      db.addCollection('a').insert([{ x: 1 }, { x: 2 }]);
      await db.saveDatabase();

      await rename(before, after);

      const moved = await Loki.open(join(after, 'app.db'), {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter()),
      });
      expect(moved.getCollection('a')?.count()).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest listing anything but its own generation files, and deletes none', async () => {
    for (const file of ['7', '../evil', 'g.db.7', '0.g1-abcd/../../7', 'g.db.0.g1-abcd']) {
      const inner = new LokiMemoryAdapter();
      await populated(inner);
      const container = JSON.parse(inner.hashStore['g.db'].value);
      container.lokiPartitions.collections[0].files = [file];
      await inner.saveDatabase('g.db', JSON.stringify(container));
      await inner.saveDatabase('g.db.7', 'user data');
      await inner.saveDatabase('g.db.g.db.0.g1-abcd', 'user data');
      const keys = Object.keys(inner.hashStore).sort();

      await expect(
        Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) }),
      ).rejects.toThrow(`lists an invalid file ${file}`);
      const fresh = new Loki('g.db', { adapter: new LokiPartitioningAdapter(inner) });
      fresh.addCollection('a');
      await fresh.saveDatabase().catch(() => {});
      await new LokiPartitioningAdapter(inner).deleteDatabase('g.db').catch(() => {});

      expect(Object.keys(inner.hashStore).sort()).toEqual(keys);
    }
  });

  it('deletes a database with an invalid manifest through listing only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loki-generations-'));
    try {
      const name = join(dir, 'app.db');
      const db = new Loki(name, { adapter: new LokiPartitioningAdapter(new LokiFsAdapter()) });
      db.addCollection('a').insert({ x: 1 });
      db.addCollection('b').insert({ y: 1 });
      await db.saveDatabase();
      await writeFile(join(dir, 'app.db.7'), 'user data');
      const container = JSON.parse(await readFile(name, 'utf8'));
      container.lokiPartitions.collections[0].files = ['7'];
      await writeFile(name, JSON.stringify(container));

      await new LokiPartitioningAdapter(new LokiFsAdapter()).deleteDatabase(name);

      expect(await readdir(dir)).toEqual(['app.db.7']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to delete a database with an invalid manifest without listing', async () => {
    const inner = new LokiMemoryAdapter();
    await populated(inner);
    const container = JSON.parse(inner.hashStore['g.db'].value);
    container.lokiPartitions.generation = -1;
    await inner.saveDatabase('g.db', JSON.stringify(container));
    const keys = Object.keys(inner.hashStore).sort();

    await expect(new LokiPartitioningAdapter(inner).deleteDatabase('g.db')).rejects.toThrow(
      'malformed partition manifest',
    );
    expect(Object.keys(inner.hashStore).sort()).toEqual(keys);
  });

  it('rejects a malformed manifest', async () => {
    const malformed: ((manifest: any) => void)[] = [
      (m) => {
        m.generation = -1;
      },
      (m) => {
        m.generation = 1.5;
      },
      (m) => {
        m.generation = '1';
      },
      (m) => {
        m.collections.pop();
      },
      (m) => {
        m.collections.push({ name: 'c', files: [] });
      },
      (m) => {
        m.collections[0] = { name: 'a', files: '0.g1-abcd' };
      },
      (m) => {
        m.collections[0] = { name: 1, files: [] };
      },
      (m) => {
        m.collections[0] = null;
      },
      (m) => {
        m.collections[0].files = [42];
      },
      (m) => {
        m.collections.reverse();
      },
    ];
    for (const change of malformed) {
      const inner = new LokiMemoryAdapter();
      await populated(inner);
      const container = JSON.parse(inner.hashStore['g.db'].value);
      change(container.lokiPartitions);
      await inner.saveDatabase('g.db', JSON.stringify(container));

      await expect(
        Loki.open('g.db', { adapter: new LokiPartitioningAdapter(inner) }),
      ).rejects.toThrow(/partition manifest/);
    }
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
        ['app.db', ...userFiles, `app.db.${committed}`].sort(),
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

/** Memory adapter with line streams that records how it was used. */
class LineMemoryAdapter extends LokiMemoryAdapter {
  streamedWrites = 0;
  streamedReads = 0;

  async readLines(name: string): Promise<AsyncIterable<string> | null> {
    const stored = this.hashStore[name];
    if (!stored) {
      return null;
    }
    this.streamedReads++;
    const lines = stored.value.split('\n');
    return (async function* () {
      yield* lines;
    })();
  }

  async writeLines(name: string, lines: AsyncIterable<string>): Promise<void> {
    this.streamedWrites++;
    let text = '';
    for await (const line of lines) {
      text += `${line}\n`;
    }
    await this.saveDatabase(name, text);
  }
}

describe('LokiPartitioningAdapter line streams', () => {
  it('streams each collection through the inner adapter', async () => {
    const inner = new LineMemoryAdapter();
    const db = new Loki('s.db', {
      adapter: new LokiPartitioningAdapter(inner, { paging: true, pageSize: 10 }),
    });
    db.addCollection('a').insert(Array.from({ length: 50 }, (_, x) => ({ x })));
    await db.saveDatabase();

    expect(inner.streamedWrites).toBe(1);
    expect(
      JSON.parse(inner.hashStore['s.db'].value).lokiPartitions.collections[0].files,
    ).toHaveLength(1);

    const reopened = await Loki.open('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(inner.streamedReads).toBe(1);
    expect(reopened.getCollection('a')?.count()).toBe(50);
  });

  it('reads what a plain adapter wrote, and the other way round', async () => {
    const lines = new LineMemoryAdapter();
    const streamed = new Loki('s.db', { adapter: new LokiPartitioningAdapter(lines) });
    streamed.addCollection('a').insert(Array.from({ length: 20 }, (_, x) => ({ x })));
    await streamed.saveDatabase();
    const plain = new LokiMemoryAdapter();
    plain.hashStore = lines.hashStore;
    const fromPlain = await Loki.open('s.db', { adapter: new LokiPartitioningAdapter(plain) });
    expect(fromPlain.getCollection('a')?.count()).toBe(20);

    const other = new LokiMemoryAdapter();
    const paged = new Loki('p.db', {
      adapter: new LokiPartitioningAdapter(other, { paging: true, pageSize: 10 }),
    });
    paged.addCollection('a').insert(Array.from({ length: 30 }, (_, x) => ({ x })));
    await paged.saveDatabase();
    expect(
      JSON.parse(other.hashStore['p.db'].value).lokiPartitions.collections[0].files.length,
    ).toBeGreaterThan(1);
    const reader = new LineMemoryAdapter();
    reader.hashStore = other.hashStore;
    const fromLines = await Loki.open('p.db', { adapter: new LokiPartitioningAdapter(reader) });
    expect(fromLines.getCollection('a')?.count()).toBe(30);
    expect(reader.streamedReads).toBeGreaterThan(1);
  });

  it('reports a streamed file that is missing', async () => {
    const inner = new LineMemoryAdapter();
    const db = new Loki('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.addCollection('a').insert({ x: 1 });
    await db.saveDatabase();
    const [file] = JSON.parse(inner.hashStore['s.db'].value).lokiPartitions.collections[0].files;
    delete inner.hashStore[`s.db.${file}`];

    await expect(
      Loki.open('s.db', { adapter: new LokiPartitioningAdapter(inner) }),
    ).rejects.toThrow(/is missing/);
  });

  it('round-trips an empty collection through the stream', async () => {
    const inner = new LineMemoryAdapter();
    const db = new Loki('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.addCollection('a');
    await db.saveDatabase();

    const reopened = await Loki.open('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    expect(inner.streamedReads).toBe(1);
    expect(reopened.getCollection('a')?.count()).toBe(0);
  });

  it('keeps line breaks, quotes and unicode in documents', async () => {
    const inner = new LineMemoryAdapter();
    const db = new Loki('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    db.addCollection('a').insert({ text: 'a\nb', quoted: 'say "hi"', accent: 'é' });
    await db.saveDatabase();

    const reopened = await Loki.open('s.db', { adapter: new LokiPartitioningAdapter(inner) });
    const doc = reopened.getCollection('a')?.find()[0];
    expect(doc?.text).toBe('a\nb');
    expect(doc?.quoted).toBe('say "hi"');
    expect(doc?.accent).toBe('é');
  });
});
