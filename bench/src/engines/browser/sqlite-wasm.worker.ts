import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { BenchDoc } from '../../core/data.ts';
import { SCHEMA_SQL, type SqlDriver, sqlInsertMany, sqlUpdateScores } from '../shared/sql.ts';
import { wasmSqlDriver } from './sqlite-wasm.ts';

interface Request {
  id: number;
  op: string;
  args: unknown[];
}

const ready = sqlite3InitModule().then((sqlite3) =>
  sqlite3.installOpfsSAHPoolVfs({ name: 'lokits-bench' }),
);
let driver: SqlDriver | undefined;

function opened(): SqlDriver {
  if (!driver) {
    throw new Error('database not open');
  }
  return driver;
}

async function handle(op: string, args: unknown[]): Promise<unknown> {
  const pool = await ready;
  switch (op) {
    case 'open':
      driver = wasmSqlDriver(new pool.OpfsSAHPoolDb(args[0] as string));
      driver.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      driver.exec(SCHEMA_SQL);
      return null;
    case 'insertMany':
      sqlInsertMany(opened(), args[0] as BenchDoc[]);
      return null;
    case 'updateScores':
      sqlUpdateScores(opened(), args[0] as number[], args[1] as number);
      return null;
    case 'findEq':
      return opened()
        .all('SELECT * FROM docs WHERE email = ?', [args[0] as string])
        .map((r) => Number(r.id));
    case 'close':
      driver?.close();
      driver = undefined;
      return null;
    case 'destroy':
      pool.unlink(args[0] as string);
      return null;
    default:
      throw new Error(`unknown op ${op}`);
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, op, args } = event.data;
  try {
    self.postMessage({ id, result: await handle(op, args) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
