import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Loki, LokiFsAdapter, LokiMemoryAdapter, LokiPartitioningAdapter } from '../../src';

function sampleDb(adapter: unknown) {
  const db = new Loki('p.db', { adapter: adapter as any });
  db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
  db.addCollection('empty');
  return db;
}

describe('LokiPartitioningAdapter, historical format', () => {
  it('still writes the historical keys', async () => {
    const inner = new LokiMemoryAdapter();
    await sampleDb(new LokiPartitioningAdapter(inner, { generations: false })).saveDatabase();

    expect(Object.keys(inner.hashStore).sort()).toEqual(['p.db', 'p.db.0', 'p.db.1']);
  });

  it('writes and reads the fs-structured format (one document per line)', async () => {
    const inner = new LokiMemoryAdapter();
    const db = sampleDb(
      new LokiPartitioningAdapter(inner, { legacyFormat: 'lines', generations: false }),
    );
    await db.saveDatabase();

    const users = db.getCollection('users')?.data ?? [];
    expect(inner.hashStore['p.db.0'].value).toBe(
      users.map((doc) => `${JSON.stringify(doc)}\n`).join(''),
    );
    expect(inner.hashStore['p.db'].value.endsWith('\n')).toBe(true);
    const reopened = await Loki.open('p.db', {
      adapter: new LokiPartitioningAdapter(inner, { legacyFormat: 'lines', generations: false }),
    });
    expect(reopened.getCollection('users')?.count()).toBe(2);
    expect(reopened.getCollection('empty')?.count()).toBe(0);
  });

  it('deletes the container then the partitions', async () => {
    const inner = new LokiMemoryAdapter();
    const adapter = new LokiPartitioningAdapter(inner, { generations: false });
    const db = sampleDb(adapter);
    await db.saveDatabase();

    await db.deleteDatabase();

    expect(Object.keys(inner.hashStore)).toEqual([]);
  });

  it('deletes paged partitions', async () => {
    const inner = new LokiMemoryAdapter();
    const adapter = new LokiPartitioningAdapter(inner, {
      paging: true,
      pageSize: 20,
      generations: false,
    });
    const db = sampleDb(adapter);
    await db.saveDatabase();
    expect(Object.keys(inner.hashStore).length).toBeGreaterThan(3);

    await db.deleteDatabase();

    expect(Object.keys(inner.hashStore)).toEqual([]);
  });

  it('deletes a missing database without error', async () => {
    await expect(
      new LokiPartitioningAdapter(new LokiMemoryAdapter()).deleteDatabase('none.db'),
    ).resolves.toBeUndefined();
  });

  it('never deletes files it did not write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loki-partitioning-'));
    try {
      const name = join(dir, 'app.db');
      const db = new Loki(name, {
        adapter: new LokiPartitioningAdapter(new LokiFsAdapter(), { generations: false }),
      });
      db.addCollection('users').insert({ name: 'odin' });
      await db.saveDatabase();
      for (const user of ['app.db.7', 'app.db.2024', 'app.db.5.0']) {
        await writeFile(join(dir, user), 'user data');
      }

      await db.deleteDatabase();

      expect((await readdir(dir)).sort()).toEqual(['app.db.2024', 'app.db.5.0', 'app.db.7']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing non-paged partition explicitly', async () => {
    const inner = new LokiMemoryAdapter();
    await sampleDb(new LokiPartitioningAdapter(inner, { generations: false })).saveDatabase();
    delete inner.hashStore['p.db.0'];

    await expect(new LokiPartitioningAdapter(inner).loadDatabase('p.db')).rejects.toThrow(
      'partition p.db.0 is missing',
    );
  });

  it('round-trips a lines database without collections', async () => {
    const inner = new LokiMemoryAdapter();
    const options = { legacyFormat: 'lines', generations: false } as const;
    await new Loki('p.db', { adapter: new LokiPartitioningAdapter(inner, options) }).saveDatabase();

    const reopened = await Loki.open('p.db', {
      adapter: new LokiPartitioningAdapter(inner, options),
    });

    expect(reopened.collections).toEqual([]);
  });
});
