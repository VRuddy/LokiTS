import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { MemoryEngine } from '../../core/engine.ts';
import { type SqlDriver, sqlMemoryDb } from '../shared/sql.ts';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Database = InstanceType<Sqlite3['oo1']['DB']>;
type Statement = ReturnType<Database['prepare']>;

let module: Promise<Sqlite3> | undefined;
export const loadSqlite = () => {
  module ??= sqlite3InitModule();
  return module;
};

export function wasmSqlDriver(db: Database): SqlDriver {
  const statements = new Map<string, Statement>();
  const prepared = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    all: (sql, params) => {
      const statement = prepared(sql);
      const rows: Record<string, unknown>[] = [];
      try {
        if (params.length > 0) {
          statement.bind(params);
        }
        while (statement.step()) {
          rows.push(statement.get({}) as Record<string, unknown>);
        }
      } finally {
        statement.reset(true);
      }
      return rows;
    },
    run: (sql, params) => {
      const statement = prepared(sql);
      try {
        statement.bind(params);
        statement.step();
      } finally {
        statement.reset(true);
      }
    },
    close: () => {
      for (const statement of statements.values()) {
        statement.finalize();
      }
      db.close();
    },
  };
}

export const sqliteWasm: MemoryEngine = {
  name: 'SQLite',
  packageName: '@sqlite.org/sqlite-wasm',
  envs: ['browser'],
  sync: true,
  notes:
    'Official WASM build on the main thread, in-memory database, cached prepared statements, SELECT *. No live queries.',
  async create() {
    const sqlite3 = await loadSqlite();
    return sqlMemoryDb(wasmSqlDriver(new sqlite3.oo1.DB(':memory:', 'c')));
  },
};
