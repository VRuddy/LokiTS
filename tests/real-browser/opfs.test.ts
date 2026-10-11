import { describe, expect, it } from 'vitest';

describe('OPFS', () => {
  it('writes and reads back a file', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('opfs-smoke.txt', { create: true });
    try {
      const writable = await handle.createWritable();
      await writable.write('odin');
      await writable.close();
      expect(await (await handle.getFile()).text()).toBe('odin');
    } finally {
      await root.removeEntry('opfs-smoke.txt');
    }
  });
});
