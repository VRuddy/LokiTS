import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Les specs historiques utilisent des chemins relatifs (test.db, sandbox.db…) :
// on isole chaque worker dans un cwd jetable pour ne pas polluer le dépôt.
process.chdir(mkdtempSync(join(tmpdir(), 'loki-ts-')));
