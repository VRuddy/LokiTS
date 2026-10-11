// Save/load of 100k documents to disk, single file then partitioned with line streams.
// LOKI_ENGINE=legacy runs lokijs 1.5.12 (its LokiFsAdapter and fs-structured adapter).
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loki = require('./engine.js');

const legacy = process.env.LOKI_ENGINE === 'legacy';
const Structured = legacy
  ? require('lokijs/src/loki-fs-structured-adapter.js')
  : require('../dist/index.cjs').LokiFsStructuredAdapter;
const dir = mkdtempSync(join(tmpdir(), 'loki-bench-'));

function fill(db) {
  const items = db.addCollection('items', { indices: ['age'] });
  for (let i = 0; i < 100000; i++) {
    items.insert({ id: i, age: i % 100, name: `n${i}` });
  }
  return items;
}

function time(label, run) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    run((err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`${label}: ${Number(process.hrtime.bigint() - start) / 1e6} ms`);
      resolve();
    });
  });
}

(async () => {
  try {
    const setups = [
      ['single file', () => new loki.LokiFsAdapter()],
      ['partitioned', () => new Structured()],
    ];
    for (const [label, makeAdapter] of setups) {
      const file = join(dir, `${label.replace(' ', '-')}.db`);
      const db = new loki(file, { adapter: makeAdapter() });
      const items = fill(db);
      for (let round = 0; round < 3; round++) {
        // touch one document so the partitioned save rewrites the collection every round
        items.update(items.get(1));
        await time(`${label} save`, (done) => db.saveDatabase(done));
        await time(`${label} load`, (done) => {
          const fresh = new loki(file, { adapter: makeAdapter() });
          fresh.loadDatabase({}, (err) => {
            const loaded = fresh.getCollection('items');
            if (!err && (!loaded || loaded.count() !== 100000)) {
              done(new Error('incomplete load'));
              return;
            }
            done(err);
          });
        });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
