// The original UMD module was the Loki constructor itself: `new (require('lokijs'))('db')`.
// tsup emits `exports.default = Loki`; this makes `module.exports` the constructor, with the
// named exports (Collection, LokiOps, ...) kept as properties of it.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../dist/index.cjs', import.meta.url);
const marker = '//# sourceMappingURL=';
const source = readFileSync(file, 'utf8');
const at = source.indexOf(marker);
const patch = 'module.exports = Object.assign(exports.default, exports);\n';

if (at === -1 || source.includes(patch)) {
  throw new Error('dist/index.cjs has an unexpected shape');
}
writeFileSync(file, source.slice(0, at) + patch + source.slice(at));
