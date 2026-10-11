import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Loki, LokiFsStructuredAdapter } from '../../src';

const require = createRequire(import.meta.url);
const LegacyLoki = require('lokijs');
const LegacyFsStructured = require('lokijs/src/loki-fs-structured-adapter.js');

const newFile = () => join(mkdtempSync(join(tmpdir(), 'loki-structured-')), 'app.db');

const legacySave = (db: any) =>
  new Promise<void>((resolve, reject) =>
    db.saveDatabase((err: unknown) => (err ? reject(err) : resolve())),
  );

describe('LokiFsStructuredAdapter', () => {
  it('opens a database written by the original fs-structured adapter, then converts it', async () => {
    const file = newFile();
    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    legacy
      .addCollection('users', { unique: ['name'] })
      .insert([{ name: 'odin' }, { name: 'thor' }]);
    legacy.addCollection('empty');
    await legacySave(legacy);

    const db = await Loki.open(file, { adapter: new LokiFsStructuredAdapter() });
    expect(db.getCollection('users')?.by('name', 'thor')).toBeTruthy();
    expect(db.getCollection('empty')?.count()).toBe(0);

    db.getCollection('users')?.insert({ name: 'loki' });
    await db.saveDatabase();
    const names = readdirSync(join(file, '..'));
    expect(names).not.toContain('app.db.0');
    expect(names.some((name) => /^app\.db\.0\.g1-/.test(name))).toBe(true);

    const reopened = await Loki.open(file, { adapter: new LokiFsStructuredAdapter() });
    expect(reopened.getCollection('users')?.count()).toBe(3);
  });

  it('writes the original layout with generations: false', async () => {
    const file = newFile();
    const db = new Loki(file, { adapter: new LokiFsStructuredAdapter({ generations: false }) });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();

    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    await new Promise<void>((resolve, reject) =>
      legacy.loadDatabase({}, (err: unknown) => (err ? reject(err) : resolve())),
    );
    expect(legacy.getCollection('users').findOne({ name: 'odin' })).toBeTruthy();
  });

  it('loads a database without collections', async () => {
    const file = newFile();
    await new Loki(file, { adapter: new LokiFsStructuredAdapter() }).saveDatabase();

    const db = await Loki.open(file, { adapter: new LokiFsStructuredAdapter() });

    expect(db.listCollections()).toEqual([]);
  });

  it('loads an original database without collections', async () => {
    const file = newFile();
    await legacySave(new LegacyLoki(file, { adapter: new LegacyFsStructured() }));

    const db = await Loki.open(file, { adapter: new LokiFsStructuredAdapter() });

    expect(db.listCollections()).toEqual([]);
  });

  it('rejects a corrupted line', async () => {
    const file = newFile();
    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    legacy.addCollection('users').insert({ name: 'odin' });
    await legacySave(legacy);
    writeFileSync(`${file}.0`, '{"name":"odin"\n');

    await expect(
      Loki.open(file, { adapter: new LokiFsStructuredAdapter() }),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it('reports write errors', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'loki-structured-')), 'missing-dir', 'app.db');
    const db = new Loki(file, { adapter: new LokiFsStructuredAdapter() });
    db.addCollection('users').insert({ name: 'odin' });

    await expect(db.saveDatabase()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
