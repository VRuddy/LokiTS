import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    db.addCollection('gods').insert({ name: 'thor' });
    await db.saveDatabase();

    expect(readdirSync(join(file, '..')).filter((name) => /\.g\d+-/.test(name))).toEqual([]);
    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    await new Promise<void>((resolve, reject) =>
      legacy.loadDatabase({}, (err: unknown) => (err ? reject(err) : resolve())),
    );
    expect(legacy.getCollection('users').findOne({ name: 'odin' })).toBeTruthy();
    expect(legacy.getCollection('gods').findOne({ name: 'thor' })).toBeTruthy();
  });

  it('keeps its layout whatever the options say', async () => {
    const file = newFile();
    const options = { legacyFormat: 'partitioning', paging: true, pageSize: 1 } as object;
    const db = new Loki(file, { adapter: new LokiFsStructuredAdapter(options) });
    db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
    await db.saveDatabase();

    const names = readdirSync(join(file, '..'));
    const partitions = names.filter((name) => name.startsWith('app.db.0'));
    expect(partitions).toHaveLength(1);
    const lines = readFileSync(join(file, '..', partitions[0] as string), 'utf8')
      .trim()
      .split('\n');
    expect(lines.map((line) => JSON.parse(line).name)).toEqual(['odin', 'thor']);
  });

  it('writes the original layout with generations: false whatever the other options say', async () => {
    const file = newFile();
    const options = {
      generations: false,
      legacyFormat: 'partitioning',
      paging: true,
      pageSize: 1,
    } as object;
    const db = new Loki(file, { adapter: new LokiFsStructuredAdapter(options) });
    db.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
    await db.saveDatabase();

    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    await new Promise<void>((resolve, reject) =>
      legacy.loadDatabase({}, (err: unknown) => (err ? reject(err) : resolve())),
    );
    expect(legacy.getCollection('users').count()).toBe(2);
  });

  it('opens an original database whatever the other options say', async () => {
    const file = newFile();
    const legacy = new LegacyLoki(file, { adapter: new LegacyFsStructured() });
    legacy.addCollection('users').insert({ name: 'odin' });
    await legacySave(legacy);

    const options = { legacyFormat: 'partitioning', paging: true } as object;
    const db = await Loki.open(file, { adapter: new LokiFsStructuredAdapter(options) });

    expect(db.getCollection('users')?.count()).toBe(1);
  });

  it('uses generations when the option is undefined', async () => {
    const file = newFile();
    const db = new Loki(file, {
      adapter: new LokiFsStructuredAdapter({ generations: undefined }),
    });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();

    expect(readdirSync(join(file, '..')).some((name) => /\.g1-/.test(name))).toBe(true);
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

    const failure = Loki.open(file, { adapter: new LokiFsStructuredAdapter() });

    await expect(failure).rejects.toBeInstanceOf(SyntaxError);
    await expect(failure).rejects.toThrow(`partition ${file}.0 holds invalid JSON`);
  });

  it('reports write errors', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'loki-structured-')), 'missing-dir', 'app.db');
    const db = new Loki(file, { adapter: new LokiFsStructuredAdapter() });
    db.addCollection('users').insert({ name: 'odin' });

    await expect(db.saveDatabase()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
