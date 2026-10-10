// LOKI_ENGINE=legacy runs the benchmarks against the original lokijs from npm, for comparison.
module.exports =
  process.env.LOKI_ENGINE === 'legacy' ? require('lokijs') : require('../dist/index.cjs').loki;
