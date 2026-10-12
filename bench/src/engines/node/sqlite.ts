import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { MemoryEngine } from '../../core/engine.ts';
import { type SqlDriver, sqlMemoryDb } from '../shared/sql.ts';

export function nodeSqlDriver(path: string): SqlDriver {
  const db = new DatabaseSync(path);
  const statements = new Map<string, StatementSync>();
  const prepared = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params) => prepared(sql).all(...params) as Record<string, unknown>[],
    run: (sql, params) => {
      prepared(sql).run(...params);
    },
    close: () => db.close(),
  };
}

export const sqliteNode: MemoryEngine = {
  name: 'SQLite',
  packageName: 'node:sqlite',
  envs: ['node'],
  sync: true,
  notes:
    'node:sqlite, in-memory database, cached prepared statements, SELECT * (full rows, tags kept as JSON text), one transaction per bulk insert. No live queries.',
  create: () => sqlMemoryDb(nodeSqlDriver(':memory:')),
};
