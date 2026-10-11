import { Loki, LokiOpfsAdapter } from '../../src';

const directory = `worker-${crypto.randomUUID()}`;

async function run() {
  const root = await navigator.storage.getDirectory();
  try {
    const db = new Loki('worker.db', { adapter: new LokiOpfsAdapter({ directory }) });
    db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
    await db.saveDatabase();
    const reloaded = await Loki.open('worker.db', { adapter: new LokiOpfsAdapter({ directory }) });
    const count = reloaded.getCollection('users')?.count();

    let lockedCode: string | undefined;
    const dir = await root.getDirectoryHandle(directory);
    const handle = await dir.getFileHandle('worker.db');
    const proto = Object.getPrototypeOf(handle) as { createSyncAccessHandle?: unknown };
    if (typeof proto.createSyncAccessHandle === 'function') {
      const sync = await (
        handle as unknown as { createSyncAccessHandle(): Promise<{ close(): void }> }
      ).createSyncAccessHandle();
      try {
        await new LokiOpfsAdapter({ directory }).saveDatabase('worker.db', 'x');
      } catch (err) {
        lockedCode = (err as { code?: string }).code;
      } finally {
        sync.close();
      }
    }
    return { count, lockedCode };
  } finally {
    await root.removeEntry(directory, { recursive: true }).catch(() => {});
  }
}

run().then(
  (result) => postMessage(result),
  (err) => postMessage({ error: String(err) }),
);
