import { afterEach, describe, expect, it } from 'vitest';
import { Loki, LokiOpfsAdapter, LokiPartitioningAdapter } from '../../src';

const directory = `tests-${crypto.randomUUID()}`;

afterEach(async () => {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(directory, { recursive: true }).catch(() => {});
});

async function* failingLines() {
  // more than one write chunk, so bytes reach the writable before the failure
  yield 'x'.repeat(300_000);
  yield '{"a":1}';
  throw new Error('source failed');
}

describe('LokiOpfsAdapter in a browser', () => {
  it('reports its support', async () => {
    await expect(LokiOpfsAdapter.isSupported()).resolves.toBe(true);
  });

  it('round-trips a database', async () => {
    const db = new Loki('app.db', { adapter: new LokiOpfsAdapter({ directory }) });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();
    const reloaded = await Loki.open('app.db', { adapter: new LokiOpfsAdapter({ directory }) });
    expect(reloaded.getCollection('users')?.count()).toBe(1);
  });

  it('keeps the old content when a write is interrupted', async () => {
    const adapter = new LokiOpfsAdapter({ directory });
    await adapter.saveDatabase('atomic.db', 'old');
    await expect(adapter.writeLines('atomic.db', failingLines())).rejects.toThrow('source failed');
    await expect(adapter.loadDatabase('atomic.db')).resolves.toBe('old');
    expect(await adapter.listKeys('atomic')).toEqual(['atomic.db']);
  });

  it('stores one file per collection under LokiPartitioningAdapter', async () => {
    const adapter = () => new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory }));
    const db = new Loki('parts.db', { adapter: adapter() });
    db.addCollection('users').insert(Array.from({ length: 5000 }, (_, n) => ({ n })));
    db.addCollection('gods').insert({ name: 'loki' });
    await db.saveDatabase();
    const reloaded = await Loki.open('parts.db', { adapter: adapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(5000);
    expect(reloaded.getCollection('gods')?.count()).toBe(1);
  });
});
