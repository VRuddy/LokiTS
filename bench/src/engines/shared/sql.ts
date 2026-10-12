import type { BenchDoc } from '../../core/data.ts';
import type { MemoryDb } from '../../core/engine.ts';

export type SqlValue = string | number;

export interface SqlDriver {
  exec(sql: string): void;
  all(sql: string, params: SqlValue[]): Record<string, unknown>[];
  run(sql: string, params: SqlValue[]): void;
  close(): void;
}

export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, age INTEGER,
  city TEXT, score REAL, tags TEXT, createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS docs_age ON docs(age);`;

const INSERT = 'INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const ids = (rows: Record<string, unknown>[]) => rows.map((r) => Number(r.id));

export function sqlInsertMany(driver: SqlDriver, docs: BenchDoc[]): void {
  driver.exec('BEGIN');
  for (const d of docs) {
    driver.run(INSERT, [
      d.id,
      d.name,
      d.email,
      d.age,
      d.city,
      d.score,
      JSON.stringify(d.tags),
      d.createdAt,
    ]);
  }
  driver.exec('COMMIT');
}

export function sqlUpdateScores(driver: SqlDriver, list: number[], score: number): void {
  driver.exec('BEGIN');
  for (const id of list) {
    driver.run('UPDATE docs SET score = ? WHERE id = ?', [score, id]);
  }
  driver.exec('COMMIT');
}

export function sqlMemoryDb(driver: SqlDriver): MemoryDb {
  driver.exec(SCHEMA_SQL);
  return {
    insertMany: (docs) => sqlInsertMany(driver, docs),
    findEq: (field, value) => ids(driver.all(`SELECT * FROM docs WHERE ${field} = ?`, [value])),
    findRange: (field, lo, hi) =>
      ids(driver.all(`SELECT * FROM docs WHERE ${field} BETWEEN ? AND ?`, [lo, hi])),
    findCompound: (city, minAge) =>
      ids(driver.all('SELECT * FROM docs WHERE city = ? AND age > ?', [city, minAge])),
    sortLimit: (limit) =>
      ids(driver.all('SELECT * FROM docs ORDER BY score DESC LIMIT ?', [limit])),
    updateOne: (id, score) => driver.run('UPDATE docs SET score = ? WHERE id = ?', [score, id]),
    removeOne: (id) => driver.run('DELETE FROM docs WHERE id = ?', [id]),
    count: () => Number(driver.all('SELECT count(*) AS n FROM docs', [])[0].n),
    close: () => driver.close(),
  };
}
