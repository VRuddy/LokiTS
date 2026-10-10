// Smoke test du build publié (dist/), exécutable sur Node 20+ sans Vitest :
//   pnpm build && node --test dist-tests/smoke.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

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
}
