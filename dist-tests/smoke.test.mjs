// Smoke test du build publié (dist/), exécutable sur Node 20+ sans Vitest :
//   pnpm build && node --test dist-tests/smoke.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

for (const [format, load] of [
  ['ESM', () => import('../dist/index.js')],
  ['CJS', async () => require('../dist/index.cjs')],
]) {
  test(`${format} : insertion, requête indexée et vue dynamique`, async () => {
    const { loki: Loki } = await load();
    const db = new Loki('smoke.db');
    const users = db.addCollection('users', { indices: ['age'] });
    users.insert([
      { name: 'Odin', age: 50 },
      { name: 'Thor', age: 35 },
      { name: 'Loki', age: 30 },
    ]);

    assert.deepEqual(
      users
        .find({ age: { $gte: 35 } })
        .map((u) => u.name)
        .sort(),
      ['Odin', 'Thor'],
    );

    const view = users.addDynamicView('older');
    view.applyFind({ age: { $gt: 30 } });
    assert.equal(view.data().length, 2);
    users.insert({ name: 'Freya', age: 40 });
    assert.equal(view.data().length, 3);
  });

  test(`${format} : sérialisation aller-retour`, async () => {
    const { loki: Loki } = await load();
    const db = new Loki('roundtrip.db');
    db.addCollection('c').insert({ a: 1 });
    const copy = new Loki('roundtrip.db');
    copy.loadJSON(db.serialize());
    assert.equal(copy.getCollection('c').count(), 1);
  });

  test(`${format} : persistance fichier (adaptateur fs par défaut)`, async () => {
    const { loki: Loki } = await load();
    const file = join(mkdtempSync(join(tmpdir(), 'loki-smoke-')), 'p.db');
    const db = new Loki(file);
    db.addCollection('c').insert({ a: 1 });
    await new Promise((resolve) => db.saveDatabase(resolve));
    const db2 = new Loki(file);
    await new Promise((resolve) => db2.loadDatabase({}, resolve));
    assert.equal(db2.getCollection('c').count(), 1);
  });
}

test("CJS : require() renvoie le constructeur, comme le module lokijs d'origine", () => {
  const Loki = require('../dist/index.cjs');
  const db = new Loki('shape.db');

  assert.equal(typeof Loki, 'function');
  assert.equal(typeof db.addCollection, 'function');
  assert.equal(Loki.Collection, Loki.loki.Collection);
  assert.equal(Loki.default, Loki);
  assert.equal(typeof Loki.LokiOps.$eq, 'function');
});

test('le build n’embarque plus l’ancien adaptateur IndexedDB', () => {
  for (const file of ['../dist/index.js', '../dist/index.cjs']) {
    const code = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.equal(code.includes('LokiCatalog'), false, file);
  }
});

test('les déclarations se compilent sans la lib DOM (projet Node, skipLibCheck: false)', () => {
  const tsc = require.resolve('typescript/bin/tsc');
  const project = fileURLToPath(new URL('./no-dom/tsconfig.json', import.meta.url));
  try {
    execFileSync(process.execPath, [tsc, '-p', project], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    assert.fail(`${err.stdout}${err.stderr}`);
  }
});
