import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Loki, LokiFsAdapter } from '../../src';

const newDir = () => mkdtempSync(join(tmpdir(), 'loki-fs-'));

async function* numbered(count: number) {
  for (let i = 0; i < count; i++) {
    yield `line ${i}`;
  }
}

function openDescriptorsOn(file: string) {
  return readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === file;
    } catch {
      return false;
    }
  }).length;
}

async function collect(lines: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const line of lines) {
    out.push(line);
  }
  return out;
}

describe('LokiFsAdapter', () => {
  it('round-trips a database through Loki', async () => {
    const file = join(newDir(), 'app.db');
    const db = new Loki(file, { adapter: new LokiFsAdapter() });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();

    const reopened = await Loki.open(file, { adapter: new LokiFsAdapter() });

    expect(reopened.getCollection('users')?.findOne({ name: 'odin' })).toBeTruthy();
    expect(JSON.parse(readFileSync(file, 'utf8')).filename).toBe(file);
  });

  it('treats a missing file as a missing database', async () => {
    await expect(new LokiFsAdapter().loadDatabase(join(newDir(), 'none.db'))).resolves.toBeNull();
  });

  it('keeps error codes', async () => {
    const dir = newDir();
    mkdirSync(join(dir, 'folder.db'));

    await expect(new LokiFsAdapter().loadDatabase(join(dir, 'folder.db'))).rejects.toMatchObject({
      code: 'EISDIR',
    });
    await expect(
      new LokiFsAdapter().saveDatabase(join(dir, 'no', 'app.db'), 'x'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the callback API', async () => {
    const file = join(newDir(), 'app.db');
    const adapter = new LokiFsAdapter();

    const saved = await new Promise((resolve) => adapter.saveDatabase(file, 'data', resolve));
    const loaded = await new Promise((resolve) => adapter.loadDatabase(file, resolve));

    expect(saved).toBeUndefined();
    expect(loaded).toBe('data');
  });

  it('deletes a file, and a missing one without error', async () => {
    const file = join(newDir(), 'app.db');
    writeFileSync(file, 'x');
    const adapter = new LokiFsAdapter();

    await adapter.deleteDatabase(file);
    await adapter.deleteDatabase(file);

    await expect(adapter.loadDatabase(file)).resolves.toBeNull();
  });

  it('writes and reads 100 000 lines as a stream', async () => {
    const file = join(newDir(), 'big.db');
    const adapter = new LokiFsAdapter();

    await adapter.writeLines(file, numbered(100_000));
    const lines = await adapter.readLines(file);

    expect(readFileSync(file, 'utf8').endsWith('line 99999\n')).toBe(true);
    const all = await collect(lines as AsyncIterable<string>);
    expect(all).toHaveLength(100_000);
    expect(all[0]).toBe('line 0');
    expect(all[50_000]).toBe('line 50000');
  });

  it('calls back with the error of a failing load', async () => {
    const dir = newDir();
    mkdirSync(join(dir, 'folder.db'));

    const result = await new Promise((resolve) =>
      new LokiFsAdapter().loadDatabase(join(dir, 'folder.db'), resolve),
    );

    expect(result).toMatchObject({ code: 'EISDIR' });
  });

  describe.skipIf(!existsSync('/proc/self/fd'))('line stream cleanup', () => {
    it('closes the file when the consumer stops early', async () => {
      const file = join(newDir(), 'big.db');
      const adapter = new LokiFsAdapter();
      await adapter.writeLines(file, numbered(1000));

      for await (const line of (await adapter.readLines(file)) as AsyncIterable<string>) {
        expect(line).toBe('line 0');
        break;
      }

      expect(openDescriptorsOn(file)).toBe(0);
      await adapter.deleteDatabase(file);
      await expect(adapter.readLines(file)).resolves.toBeNull();
    });

    it('closes the file when the consumer throws', async () => {
      const file = join(newDir(), 'big.db');
      const adapter = new LokiFsAdapter();
      await adapter.writeLines(file, numbered(1000));

      const consume = async () => {
        for await (const _line of (await adapter.readLines(file)) as AsyncIterable<string>) {
          throw new Error('bad line');
        }
      };

      await expect(consume()).rejects.toThrow('bad line');
      expect(openDescriptorsOn(file)).toBe(0);
    });

    it('closes the file once the stream is fully read', async () => {
      const file = join(newDir(), 'big.db');
      const adapter = new LokiFsAdapter();
      await adapter.writeLines(file, numbered(10));

      await collect((await adapter.readLines(file)) as AsyncIterable<string>);

      expect(openDescriptorsOn(file)).toBe(0);
    });
  });

  it('returns null lines for a missing file', async () => {
    await expect(new LokiFsAdapter().readLines(join(newDir(), 'none.db'))).resolves.toBeNull();
  });

  it('lists keys with the given prefix, in the prefix form', async () => {
    const dir = newDir();
    for (const name of ['app.db', 'app.db.0.g1-abcd', 'app.db.1', 'other.db']) {
      writeFileSync(join(dir, name), 'x');
    }

    const keys = await new LokiFsAdapter().listKeys(join(dir, 'app.db.'));

    expect(keys.sort()).toEqual([join(dir, 'app.db.0.g1-abcd'), join(dir, 'app.db.1')]);
    expect(readdirSync(dir)).toHaveLength(4);
  });

  it('lists nothing in a missing directory', async () => {
    await expect(new LokiFsAdapter().listKeys(join(newDir(), 'none', 'app.db.'))).resolves.toEqual(
      [],
    );
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports EACCES on a read-only directory',
    async () => {
      const dir = newDir();
      chmodSync(dir, 0o500);

      await expect(
        new LokiFsAdapter().saveDatabase(join(dir, 'app.db'), 'x'),
      ).rejects.toMatchObject({
        code: 'EACCES',
      });
      chmodSync(dir, 0o700);
    },
  );
});
