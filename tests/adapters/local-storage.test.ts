import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, LokiLocalStorageAdapter } from '../../src';
import { FakeStorage } from '../helpers/fake-storage';

function installStorage(): FakeStorage {
  const storage = new FakeStorage();
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LokiLocalStorageAdapter', () => {
  it('round-trips a database through Loki', async () => {
    const storage = installStorage();
    const db = new Loki('ls.db', { adapter: new LokiLocalStorageAdapter() });
    db.addCollection<{ name: string }>('users').insert({ name: 'odin' });
    await db.saveDatabase();
    expect(storage.getItem('ls.db')).toContain('odin');

    const reloaded = await Loki.open('ls.db', { adapter: new LokiLocalStorageAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(1);

    await reloaded.deleteDatabase();
    expect(storage.getItem('ls.db')).toBeNull();
  });

  it('loads a missing database as null', async () => {
    installStorage();
    await expect(new LokiLocalStorageAdapter().loadDatabase('none.db')).resolves.toBeNull();
  });

  it('keeps the callback API', async () => {
    installStorage();
    const adapter = new LokiLocalStorageAdapter();
    const saved = await new Promise((resolve) => adapter.saveDatabase('cb.db', 'data', resolve));
    expect(saved).toBeUndefined();
    const loaded = await new Promise((resolve) => adapter.loadDatabase('cb.db', resolve));
    expect(loaded).toBe('data');
  });

  it('reports a full storage with EQUOTA and keeps the collection dirty', async () => {
    const storage = installStorage();
    const db = new Loki('full.db', { adapter: new LokiLocalStorageAdapter() });
    const users = db.addCollection('users');
    users.insert({ name: 'odin' });
    storage.failWith = 'QuotaExceededError';

    await expect(db.saveDatabase()).rejects.toMatchObject({
      code: 'EQUOTA',
      message: expect.stringContaining('LokiIndexedDBAdapter'),
    });
    expect(users.dirty).toBe(true);
  });

  it('keeps the context of other write failures', async () => {
    const storage = installStorage();
    storage.failWith = 'SecurityError';
    await expect(new LokiLocalStorageAdapter().saveDatabase('x.db', 'y')).rejects.toMatchObject({
      code: 'ENOTSUP',
      message: expect.stringContaining('saving x.db to localStorage'),
    });
  });

  it('reports a missing localStorage with ENOTSUP', async () => {
    const adapter = new LokiLocalStorageAdapter();
    await expect(adapter.loadDatabase('x')).rejects.toMatchObject({ code: 'ENOTSUP' });
    await expect(adapter.saveDatabase('x', 'y')).rejects.toMatchObject({ code: 'ENOTSUP' });
    await expect(adapter.deleteDatabase('x')).rejects.toMatchObject({ code: 'ENOTSUP' });
  });

  it('reports a blocked localStorage with ENOTSUP', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    await expect(new LokiLocalStorageAdapter().loadDatabase('x')).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
  });

  it('is still the default persistence of the browser environment', async () => {
    const storage = installStorage();
    const db = new Loki('default.db', { env: 'BROWSER' });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();
    expect(storage.getItem('default.db')).toContain('odin');
  });
});
