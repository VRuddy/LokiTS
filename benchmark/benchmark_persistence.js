// Save/load round-trip on 100k documents; LOKI_ENGINE=legacy runs it on lokijs 1.5.12.
const loki = require('./engine.js');

const adapter = new loki.LokiMemoryAdapter();
const db = new loki('bench.db', { adapter });
const items = db.addCollection('items', { indices: ['age'] });
for (let i = 0; i < 100000; i++) {
  items.insert({ id: i, age: i % 100, name: `n${i}` });
}

function time(label, run) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    run(() => {
      console.log(`${label}: ${Number(process.hrtime.bigint() - start) / 1e6} ms`);
      resolve();
    });
  });
}

(async () => {
  for (let round = 0; round < 3; round++) {
    await time('save', (done) => db.saveDatabase(done));
    await time('load', (done) => new loki('bench.db', { adapter }).loadDatabase({}, done));
  }
})();
