import type { Loki } from '../core/Loki';

/**
 * Promise-based adapter. Without `mode` it receives the database serialized as a string.
 * A parameter declared after the documented ones is treated as a callback and must be called: put options
 * in the constructor or in a default-valued parameter (not counted by `fn.length`).
 */
export interface LokiAdapter {
  mode?: 'normal' | 'reference';
  /** Resolves to the stored data, or `null`/`undefined` when the database does not exist yet. */
  loadDatabase(dbname: string): Promise<string | object | null | undefined>;
  saveDatabase?(dbname: string, data: string): Promise<void>;
  /** Reference mode: receives a copy of the database and serializes it itself. */
  exportDatabase?(dbname: string, db: Loki): Promise<void>;
  deleteDatabase?(dbname: string): Promise<void>;
}

/**
 * Adapter that only writes what changed; it asks for a copy of the database when it is ready.
 * A parameter declared after the documented ones is treated as a callback and must be called: put options
 * in the constructor or in a default-valued parameter (not counted by `fn.length`).
 */
export interface LokiIncrementalAdapter {
  mode: 'incremental';
  loadDatabase(dbname: string): Promise<object | null | undefined>;
  saveDatabase(dbname: string, getLokiCopy: () => Loki): Promise<void>;
  deleteDatabase?(dbname: string): Promise<void>;
}

/** Callback-based adapter contract of the original LokiJS, still accepted everywhere. */
export interface LegacyLokiAdapter {
  mode?: string;
  loadDatabase(dbname: string, callback: (value: any) => void): void;
  saveDatabase?(dbname: string, dbstring: any, callback: (err?: any) => void): void;
  deleteDatabase?(dbname: string, callback: (result?: any) => void): void;
  exportDatabase?(dbname: string, dbref: any, callback: (err?: any) => void): void;
  [key: string]: any;
}

/** @deprecated Use {@link LokiAdapter} (promises) or {@link LegacyLokiAdapter} (callbacks). */
export type LokiPersistenceAdapter = LegacyLokiAdapter;

export type AnyLokiAdapter = LokiAdapter | LokiIncrementalAdapter | LegacyLokiAdapter;
