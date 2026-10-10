import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AtomicWriteIo,
  defaultAtomicWriteIo,
  writeFileAtomic,
} from '../../src/adapters/fs/atomic-write';

const newDir = () => mkdtempSync(join(tmpdir(), 'loki-atomic-'));

async function* lines(...items: string[]) {
  for (const item of items) {
    yield item;
  }
}

/** Real I/O with hooks to fail or record each step. */
function instrumentedIo(overrides: Partial<AtomicWriteIo> = {}, log: string[] = []): AtomicWriteIo {
  const real = defaultAtomicWriteIo();
  return {
    ...real,
    open: async (path, flags) => {
      const handle = await real.open(path, flags);
      const kind = flags === 'r' ? 'dir' : 'file';
      return {
        writeFile: (data: string) => handle.writeFile(data),
        sync: async () => {
          log.push(`sync-${kind}`);
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
    rename: async (from, to) => {
      log.push('rename');
      await real.rename(from, to);
    },
    ...overrides,
  };
}

describe('writeFileAtomic', () => {
  it('writes a string and leaves only the target', async () => {
    const dir = newDir();
    const target = join(dir, 'app.db');
    writeFileSync(target, 'old');

    await writeFileAtomic(target, 'new content');

    expect(readFileSync(target, 'utf8')).toBe('new content');
    expect(readdirSync(dir)).toEqual(['app.db']);
  });

  it('writes an async iterable of chunks', async () => {
    const target = join(newDir(), 'app.db');

    await writeFileAtomic(target, lines('a\n', 'b\n', 'c\n'));

    expect(readFileSync(target, 'utf8')).toBe('a\nb\nc\n');
  });

  it('syncs the file before renaming and the directory after', async () => {
    const log: string[] = [];
    const target = join(newDir(), 'app.db');

    await writeFileAtomic(target, 'x', instrumentedIo({ platform: 'linux' }, log));

    expect(log).toEqual(['sync-file', 'rename', 'sync-dir']);
  });

  it('skips the directory sync on Windows', async () => {
    const log: string[] = [];
    const target = join(newDir(), 'app.db');

    await writeFileAtomic(target, 'x', instrumentedIo({ platform: 'win32' }, log));

    expect(log).toEqual(['sync-file', 'rename']);
  });

  for (const step of ['write', 'sync', 'rename'] as const) {
    it(`removes the temporary file when ${step} fails and keeps the target`, async () => {
      const dir = newDir();
      const target = join(dir, 'app.db');
      writeFileSync(target, 'old');
      const failure = Object.assign(new Error(`${step} failed`), { code: 'EIO' });
      const real = defaultAtomicWriteIo();
      const io: AtomicWriteIo = {
        ...real,
        platform: 'linux',
        open: async (path, flags) => {
          const handle = await real.open(path, flags);
          return {
            writeFile: (data: string) =>
              step === 'write' ? Promise.reject(failure) : handle.writeFile(data),
            sync: () => (step === 'sync' ? Promise.reject(failure) : handle.sync()),
            close: () => handle.close(),
          };
        },
        rename: (from, to) => (step === 'rename' ? Promise.reject(failure) : real.rename(from, to)),
      };

      await expect(writeFileAtomic(target, 'new', io)).rejects.toBe(failure);

      expect(readFileSync(target, 'utf8')).toBe('old');
      expect(readdirSync(dir)).toEqual(['app.db']);
    });
  }

  it('keeps the error code of the failing system call', async () => {
    const target = join(newDir(), 'missing-dir', 'app.db');

    await expect(writeFileAtomic(target, 'x')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries a locked rename on Windows', async () => {
    const real = defaultAtomicWriteIo();
    let attempts = 0;
    const target = join(newDir(), 'app.db');
    const io: AtomicWriteIo = {
      ...real,
      platform: 'win32',
      rename: (from, to) => {
        attempts++;
        return attempts <= 2
          ? Promise.reject(Object.assign(new Error('locked'), { code: 'EPERM' }))
          : real.rename(from, to);
      },
    };

    await writeFileAtomic(target, 'x', io);

    expect(attempts).toBe(3);
    expect(readFileSync(target, 'utf8')).toBe('x');
  });

  it('does not retry a failed rename outside Windows', async () => {
    const real = defaultAtomicWriteIo();
    let attempts = 0;
    const io: AtomicWriteIo = {
      ...real,
      platform: 'linux',
      rename: () => {
        attempts++;
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EPERM' }));
      },
    };

    await expect(writeFileAtomic(join(newDir(), 'app.db'), 'x', io)).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(attempts).toBe(1);
  });

  it('uses unique temporary files under concurrent writes', async () => {
    const dir = newDir();
    const target = join(dir, 'app.db');
    const contents = Array.from({ length: 20 }, (_, i) => `version ${i}`);

    await Promise.all(contents.map((content) => writeFileAtomic(target, content)));

    expect(contents).toContain(readFileSync(target, 'utf8'));
    expect(readdirSync(dir)).toEqual(['app.db']);
  });

  it('round-trips chunks larger than the flush threshold', async () => {
    const target = join(newDir(), 'app.db');
    const chunks = ['a', 'b', 'c'].map((c) => c.repeat(40_000));

    await writeFileAtomic(target, lines(...chunks));

    expect(readFileSync(target, 'utf8')).toBe(chunks.join(''));
  });

  it('removes the temporary file when the source iterable throws', async () => {
    const dir = newDir();
    const target = join(dir, 'app.db');
    writeFileSync(target, 'old');
    const failure = new Error('source failed');
    async function* broken() {
      yield 'partial';
      throw failure;
    }

    await expect(writeFileAtomic(target, broken())).rejects.toBe(failure);

    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['app.db']);
  });

  it('does not remove a file it did not create when open fails', async () => {
    const real = defaultAtomicWriteIo();
    const removed: string[] = [];
    const failure = Object.assign(new Error('exists'), { code: 'EEXIST' });
    const io: AtomicWriteIo = {
      ...real,
      open: () => Promise.reject(failure),
      rm: async (path, options) => {
        removed.push(path);
        await real.rm(path, options);
      },
    };

    await expect(writeFileAtomic(join(newDir(), 'app.db'), 'x', io)).rejects.toBe(failure);

    expect(removed).toEqual([]);
  });
});
