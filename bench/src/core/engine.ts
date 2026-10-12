import type { BenchDoc } from './data.ts';

export type Env = 'node' | 'browser';
export type MaybePromise<T> = T | Promise<T>;
export type EqField = 'email' | 'city';
export type RangeField = 'age' | 'score';

export interface LiveQuery {
  // resolves (or returns) once the live result holds n documents; sync engines throw if it does not
  waitForCount(n: number): MaybePromise<void>;
  stop(): MaybePromise<void>;
}

export interface MemoryDb {
  insertMany(docs: BenchDoc[]): MaybePromise<void>;
  findEq(field: EqField, value: string): MaybePromise<number[]>;
  // bounds are inclusive
  findRange(field: RangeField, lo: number, hi: number): MaybePromise<number[]>;
  // city = x AND age > minAge
  findCompound(city: string, minAge: number): MaybePromise<number[]>;
  // ids ordered by score, highest first
  sortLimit(limit: number): MaybePromise<number[]>;
  updateOne(id: number, score: number): MaybePromise<void>;
  removeOne(id: number): MaybePromise<void>;
  count(): MaybePromise<number>;
  liveQuery?(city: string): MaybePromise<LiveQuery>;
  close(): MaybePromise<void>;
}

export interface EngineInfo {
  name: string;
  packageName: string;
  envs: Env[];
  sync: boolean;
  notes: string;
}

export interface MemoryEngine extends EngineInfo {
  create(): MaybePromise<MemoryDb>;
}

export interface PersistentDb {
  insertMany(docs: BenchDoc[]): MaybePromise<void>;
  updateScores(ids: number[], score: number): MaybePromise<void>;
  findEq(field: 'email', value: string): MaybePromise<number[]>;
  // resolves once the data is confirmed by the storage
  persist(): Promise<void>;
  close(): Promise<void>;
}

export interface PersistentEngine extends EngineInfo {
  storage: string;
  durability: string;
  open(location: string): Promise<PersistentDb>;
  destroy(location: string): Promise<void>;
}
