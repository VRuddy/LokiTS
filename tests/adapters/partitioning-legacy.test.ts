import { describe, expect, it } from 'vitest';
import { Loki, LokiMemoryAdapter, LokiPartitioningAdapter } from '../../src';

function sampleDb(adapter: unknown) {
  const db = new Loki('p.db', { adapter: adapter as any });
  db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
  db.addCollection('empty');
  return db;
}

describe('LokiPartitioningAdapter, historical format', () => {
  it('still writes the historical keys', async () => {
    const inner = new LokiMemoryAdapter();
    await sampleDb(new LokiPartitioningAdapter(inner)).saveDatabase();

    expect(Object.keys(inner.hashStore).sort()).toEqual(['p.db', 'p.db.0', 'p.db.1']);
  });

  it('writes and reads the fs-structured format (one document per line)', async () => {
    const inner = new LokiMemoryAdapter();
    const db = sampleDb(new LokiPartitioningAdapter(inner, { legacyFormat: 'lines' }));
    await db.saveDatabase();

    const users = db.getCollection('users')?.data ?? [];
    expect(inner.hashStore['p.db.0'].value).toBe(
      users.map((doc) => `${JSON.stringify(doc)}\n`).join(''),
    );
    expect(inner.hashStore['p.db'].value.endsWith('\n')).toBe(true);
    const reopened = await Loki.open('p.db', {
      adapter: new LokiPartitioningAdapter(inner, { legacyFormat: 'lines' }),
    });
    expect(reopened.getCollection('users')?.count()).toBe(2);
    expect(reopened.getCollection('empty')?.count()).toBe(0);
  });

  it('deletes the container then the partitions', async () => {
    const inner = new LokiMemoryAdapter();
    const adapter = new LokiPartitioningAdapter(inner);
    const db = sampleDb(adapter);
    await db.saveDatabase();

    await db.deleteDatabase();

    expect(Object.keys(inner.hashStore)).toEqual([]);
  });

  it('deletes paged partitions', async () => {
    const inner = new LokiMemoryAdapter();
    const adapter = new LokiPartitioningAdapter(inner, { paging: true, pageSize: 20 });
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
});
