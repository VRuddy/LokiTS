import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, LokiOpfsAdapter, LokiPartitioningAdapter } from '../../src';
import { installFakeOpfs } from '../helpers/fake-opfs';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function* lines(...items: string[]) {
  yield* items;
}

async function readAll(iterable: AsyncIterable<string[]> | null): Promise<string[]> {
  const out: string[] = [];
  for await (const batch of iterable ?? []) {
    out.push(...batch);
  }
  return out;
}

describe('LokiOpfsAdapter', () => {
  it('round-trips a database through Loki in a directory', async () => {
    const fake = installFakeOpfs();
    const db = new Loki('app.db', { adapter: new LokiOpfsAdapter({ directory: 'data/loki' }) });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();
    expect(fake.read('data/loki/app.db')).toContain('odin');

    const reloaded = await Loki.open('app.db', {
      adapter: new LokiOpfsAdapter({ directory: 'data/loki' }),
    });
    expect(reloaded.getCollection('users')?.count()).toBe(1);

    await reloaded.deleteDatabase();
    expect(fake.read('data/loki/app.db')).toBeUndefined();
    await expect(
      new LokiOpfsAdapter({ directory: 'data/loki' }).deleteDatabase('app.db'),
    ).resolves.toBeUndefined();
  });

  it('loads a missing database as null', async () => {
    installFakeOpfs();
    await expect(new LokiOpfsAdapter().loadDatabase('none.db')).resolves.toBeNull();
    await expect(new LokiOpfsAdapter().readLines('none.db')).resolves.toBeNull();
  });

  it('treats an empty file as a missing database', async () => {
    const fake = installFakeOpfs();
    fake.write('half.db', '');
    await expect(new LokiOpfsAdapter().loadDatabase('half.db')).resolves.toBeNull();
  });

  it('keeps the previous content and removes a new file when a write fails', async () => {
    const fake = installFakeOpfs();
    fake.write('kept.db', 'old');
    fake.failNextWrite('kept.db', 'QuotaExceededError');
    await expect(new LokiOpfsAdapter().saveDatabase('kept.db', 'new')).rejects.toMatchObject({
      code: 'EQUOTA',
    });
    expect(fake.read('kept.db')).toBe('old');

    fake.failNextWrite('new.db', 'QuotaExceededError');
    await expect(new LokiOpfsAdapter().saveDatabase('new.db', 'data')).rejects.toMatchObject({
      code: 'EQUOTA',
    });
    expect(fake.names()).toEqual(['kept.db']);
  });

  it('reports a file locked by another context with EBUSY', async () => {
    const fake = installFakeOpfs();
    fake.write('locked.db', 'x');
    fake.lock('locked.db');
    await expect(new LokiOpfsAdapter().saveDatabase('locked.db', 'y')).rejects.toMatchObject({
      code: 'EBUSY',
    });
  });

  it('reports WebKit InvalidStateError on a locked file as EBUSY', async () => {
    const fake = installFakeOpfs();
    fake.write('locked.db', 'x');
    fake.failNextWrite('locked.db', 'InvalidStateError');
    await expect(new LokiOpfsAdapter().saveDatabase('locked.db', 'y')).rejects.toMatchObject({
      code: 'EBUSY',
    });
  });

  it('reports a file standing where a directory is expected with EINVAL', async () => {
    const fake = installFakeOpfs();
    fake.write('data', 'a file');
    const adapter = new LokiOpfsAdapter({ directory: 'data/loki' });
    await expect(adapter.saveDatabase('app.db', '{}')).rejects.toMatchObject({
      code: 'EINVAL',
      cause: expect.objectContaining({ name: 'TypeMismatchError' }),
    });
  });

  it('rejects keys that are not plain file names', async () => {
    installFakeOpfs();
    const adapter = new LokiOpfsAdapter();
    for (const key of ['', '.', '..', 'data/app.db', 'a\\b']) {
      await expect(adapter.saveDatabase(key, 'x')).rejects.toMatchObject({ code: 'EINVAL' });
    }
  });

  it('streams lines both ways', async () => {
    const fake = installFakeOpfs();
    const adapter = new LokiOpfsAdapter();
    await adapter.writeLines('lines.db', lines('{"a":1}', '{"b":2}'));
    expect(fake.read('lines.db')).toBe('{"a":1}\n{"b":2}\n');
    expect(await readAll(await adapter.readLines('lines.db'))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('lists keys by prefix without temporary files', async () => {
    const fake = installFakeOpfs();
    fake.write('app.db', '');
    fake.write('app.db.0.g1-x', '');
    fake.write('app.db.0.g1-x.crswap', '');
    fake.write('other.db', '');
    await expect(new LokiOpfsAdapter().listKeys('app.db.')).resolves.toEqual(['app.db.0.g1-x']);
  });

  it('works under LokiPartitioningAdapter', async () => {
    const fake = installFakeOpfs();
    const adapter = () => new LokiPartitioningAdapter(new LokiOpfsAdapter());
    const db = new Loki('parts.db', { adapter: adapter() });
    db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
    db.addCollection('gods').insert({ name: 'loki' });
    await db.saveDatabase();
    // only listKeys can find a generation the manifest never mentioned
    fake.write('parts.db.0.g9-orphan', 'stale');
    db.getCollection('users')?.insert({ name: 'baldr' });
    await db.saveDatabase();

    const reloaded = await Loki.open('parts.db', { adapter: adapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(3);
    expect(reloaded.getCollection('gods')?.count()).toBe(1);
    expect(fake.names().filter((name) => name.startsWith('parts.db.0.'))).toHaveLength(1);
    expect(fake.names()).not.toContain('parts.db.0.g9-orphan');
  });

  it('reports a missing OPFS with ENOTSUP', async () => {
    vi.stubGlobal('navigator', {});
    await expect(new LokiOpfsAdapter().loadDatabase('x.db')).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
    await expect(LokiOpfsAdapter.isSupported()).resolves.toBe(false);
  });

  it('reports a refused OPFS with ENOTSUP', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => {
          throw new DOMException('private mode', 'SecurityError');
        },
      },
    });
    await expect(new LokiOpfsAdapter().loadDatabase('x.db')).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
  });

  it('is supported where OPFS and createWritable are', async () => {
    installFakeOpfs();
    await expect(LokiOpfsAdapter.isSupported()).resolves.toBe(true);
  });

  it('rejects writes with ENOTSUP when createWritable is missing', async () => {
    const fake = installFakeOpfs();
    const proto = Object.getPrototypeOf(
      await fake.root.getFileHandle('probe.db', { create: true }),
    );
    const original = proto.createWritable;
    proto.createWritable = undefined;
    try {
      await expect(new LokiOpfsAdapter().saveDatabase('a.db', 'x')).rejects.toMatchObject({
        code: 'ENOTSUP',
      });
      expect(fake.names()).toEqual(['probe.db']);
    } finally {
      proto.createWritable = original;
    }
  });
});
