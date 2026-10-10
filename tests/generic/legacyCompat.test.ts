import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Loki } from '../../src';

const require = createRequire(import.meta.url);
const LegacyLoki = require('lokijs');

describe('compatibility with lokijs 1.5.12', () => {
  it('opens a database written by the original library', async () => {
    const legacy = new LegacyLoki('legacy-written.db');
    legacy.addCollection('users', { unique: ['name'] }).insert({ name: 'odin', age: 50 });
    await new Promise<void>((resolve, reject) =>
      legacy.saveDatabase((err: unknown) => (err ? reject(err) : resolve())),
    );

    const db = await Loki.open('legacy-written.db');

    expect(db.getCollection('users')?.by('name', 'odin').age).toBe(50);
  });

  it('writes a database the original library can load', async () => {
    const db = new Loki('new-written.db');
    db.addCollection('users').insert({ name: 'thor', age: 35 });
    await db.saveDatabase();

    const legacy = new LegacyLoki('new-written.db');
    await new Promise<void>((resolve, reject) =>
      legacy.loadDatabase({}, (err: unknown) => (err ? reject(err) : resolve())),
    );

    expect(legacy.getCollection('users').findOne({ name: 'thor' }).age).toBe(35);
  });
});
