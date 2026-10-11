import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Loki, LokiEncryptedAdapter, LokiFsAdapter, LokiMemoryAdapter } from '../../src';

const require = createRequire(import.meta.url);
const legacyCrypted = require('lokijs/src/loki-crypted-file-adapter.js');

// a low iteration count keeps the tests fast; the default is 600 000
const fast = (secret: string) => ({ secret, iterations: 1000 });

// the original adapter calls util.isError, which Node flags as deprecated: keep that warning out of the test output
async function writeWithLegacyAdapter(file: string, data: string, secret: string): Promise<void> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (
      !(
        rest.some((arg) => arg === 'DEP0048') ||
        (rest[0] as { code?: string } | undefined)?.code === 'DEP0048'
      )
    ) {
      return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
    }
  }) as typeof process.emitWarning;
  try {
    legacyCrypted.setSecret(secret);
    await new Promise<void>((resolve, reject) =>
      legacyCrypted.saveDatabase(file, data, (err: unknown) => (err ? reject(err) : resolve())),
    );
  } finally {
    process.emitWarning = emitWarning;
  }
}

describe('LokiEncryptedAdapter', () => {
  it('round-trips a database and stores nothing in clear', async () => {
    const inner = new LokiMemoryAdapter();
    const db = new Loki('e.db', { adapter: new LokiEncryptedAdapter(inner, fast('s3cret')) });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();

    const stored = JSON.parse(inner.hashStore['e.db'].value);
    expect(stored).toMatchObject({
      format: 'loki-encrypted',
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: 'pbkdf2-sha256',
    });
    expect(inner.hashStore['e.db'].value).not.toContain('odin');

    const reopened = await Loki.open('e.db', {
      adapter: new LokiEncryptedAdapter(inner, fast('s3cret')),
    });
    expect(reopened.getCollection('users')?.findOne({ name: 'odin' })).toBeTruthy();
  });

  it('rejects a wrong secret', async () => {
    const inner = new LokiMemoryAdapter();
    await new LokiEncryptedAdapter(inner, fast('right')).saveDatabase('e.db', 'data');

    await expect(
      new LokiEncryptedAdapter(inner, fast('wrong')).loadDatabase('e.db'),
    ).rejects.toThrow('wrong secret or corrupted data');
  });

  it('rejects tampered data', async () => {
    const inner = new LokiMemoryAdapter();
    await new LokiEncryptedAdapter(inner, fast('s')).saveDatabase('e.db', 'data');
    const envelope = JSON.parse(inner.hashStore['e.db'].value);
    const bytes = Buffer.from(envelope.value, 'base64');
    bytes[0] ^= 1;
    envelope.value = bytes.toString('base64');
    inner.hashStore['e.db'].value = JSON.stringify(envelope);

    await expect(new LokiEncryptedAdapter(inner, fast('s')).loadDatabase('e.db')).rejects.toThrow(
      'wrong secret or corrupted data',
    );
  });

  it('treats a missing database as empty', async () => {
    await expect(
      new LokiEncryptedAdapter(new LokiMemoryAdapter(), fast('s')).loadDatabase('none'),
    ).resolves.toBeNull();
  });

  it('keeps one secret per instance', async () => {
    const inner = new LokiMemoryAdapter();
    const first = new LokiEncryptedAdapter(inner, fast('first'));
    const second = new LokiEncryptedAdapter(inner, fast('second'));
    await first.saveDatabase('a.db', 'A');
    await second.saveDatabase('b.db', 'B');

    await expect(first.loadDatabase('a.db')).resolves.toBe('A');
    await expect(second.loadDatabase('b.db')).resolves.toBe('B');
    await expect(first.loadDatabase('b.db')).rejects.toThrow('wrong secret or corrupted data');
  });

  it('derives the key once for many saves, with a new IV each time', async () => {
    const inner = new LokiMemoryAdapter();
    const adapter = new LokiEncryptedAdapter(inner, fast('s'));
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const ivs = new Set<string>();

    for (let i = 0; i < 5; i++) {
      await adapter.saveDatabase('e.db', `v${i}`);
      ivs.add(JSON.parse(inner.hashStore['e.db'].value).iv);
    }

    expect(derive).toHaveBeenCalledTimes(1);
    expect(ivs.size).toBe(5);
    derive.mockRestore();
  });

  it('reads a file written by the original crypted adapter and rewrites it with GCM', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'loki-crypted-')), 'legacy.db');
    await writeWithLegacyAdapter(file, '{"legacy":true}', 'mySecret');
    expect(JSON.parse(readFileSync(file, 'utf8')).cipher).toBe('aes-256-cbc');

    const adapter = new LokiEncryptedAdapter(new LokiFsAdapter(), fast('mySecret'));
    await expect(adapter.loadDatabase(file)).resolves.toBe('{"legacy":true}');

    await adapter.saveDatabase(file, '{"legacy":false}');
    expect(JSON.parse(readFileSync(file, 'utf8')).cipher).toBe('aes-256-gcm');
    await expect(adapter.loadDatabase(file)).resolves.toBe('{"legacy":false}');
  });

  it('rejects data that is not an encrypted envelope', async () => {
    const inner = new LokiMemoryAdapter();
    await inner.saveDatabase('plain.db', '{"collections":[]}');

    await expect(
      new LokiEncryptedAdapter(inner, fast('s')).loadDatabase('plain.db'),
    ).rejects.toThrow('not encrypted');
  });

  it('works around a file adapter and deletes through it', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'loki-crypted-')), 'e.db');
    const adapter = new LokiEncryptedAdapter(new LokiFsAdapter(), fast('s'));
    await adapter.saveDatabase(file, 'data');

    await adapter.deleteDatabase(file);

    await expect(adapter.loadDatabase(file)).resolves.toBeNull();
  });

  it('requires a secret', () => {
    expect(() => new LokiEncryptedAdapter(new LokiMemoryAdapter(), { secret: '' })).toThrow(
      'requires a secret',
    );
  });
});
