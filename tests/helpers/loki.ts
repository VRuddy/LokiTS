import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Le moteur hérité est un fichier UMD/CommonJS : on le charge via le require natif de Node.
export const loki: any = require('../../src/lokijs.js');
