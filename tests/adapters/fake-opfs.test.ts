import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeOpfs } from '../helpers/fake-opfs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fake OPFS', () => {
  it('only replaces the file on close and shows a swap file meanwhile', async () => {
    const fake = installFakeOpfs();
    fake.write('a.txt', 'old');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('a.txt');
    const writable = await handle.createWritable();
    await writable.write('new');
    expect(fake.read('a.txt')).toBe('old');
    expect(fake.names()).toEqual(['a.txt', 'a.txt.crswap']);
    await writable.close();
    expect(fake.read('a.txt')).toBe('new');
    expect(fake.names()).toEqual(['a.txt']);
  });

  it('keeps the old content on abort and streams files', async () => {
    const fake = installFakeOpfs();
    fake.write('a.txt', 'line1\nline2');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('a.txt');
    const writable = await handle.createWritable();
    await writable.write('partial');
    await writable.abort();
    const file = await handle.getFile();
    expect(await file.text()).toBe('line1\nline2');
    expect(file.stream()).toBeInstanceOf(ReadableStream);
  });

  it('fails the next write with the requested error, once', async () => {
    const fake = installFakeOpfs();
    fake.write('a.txt', 'old');
    fake.failNextWrite('a.txt', 'QuotaExceededError');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('a.txt');
    const failing = await handle.createWritable();
    await expect(failing.write('x')).rejects.toMatchObject({ name: 'QuotaExceededError' });
    await failing.abort();
    const next = await handle.createWritable();
    await next.write('ok');
    await next.close();
    expect(fake.read('a.txt')).toBe('ok');
  });

  it('refuses createWritable on a locked file', async () => {
    const fake = installFakeOpfs();
    fake.write('a.txt', 'old');
    fake.lock('a.txt');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('a.txt');
    await expect(handle.createWritable()).rejects.toMatchObject({
      name: 'NoModificationAllowedError',
    });
  });

  it('handles directories, missing entries and listing', async () => {
    const fake = installFakeOpfs();
    const root = await navigator.storage.getDirectory();
    await expect(root.getFileHandle('nope')).rejects.toMatchObject({ name: 'NotFoundError' });
    const dir = await root.getDirectoryHandle('db', { create: true });
    const handle = await dir.getFileHandle('f', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new TextEncoder().encode('bytes'));
    await writable.close();
    expect(fake.read('db/f')).toBe('bytes');
    expect(fake.names('db')).toEqual(['f']);
    const keys: string[] = [];
    for await (const key of dir.keys()) {
      keys.push(key);
    }
    expect(keys).toEqual(['f']);
    await dir.removeEntry('f');
    await expect(dir.removeEntry('f')).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(handle instanceof FileSystemFileHandle).toBe(true);
  });
});
