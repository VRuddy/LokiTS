export type Family = 'memory' | 'persistence';

export interface ResultRow {
  family: Family;
  scenario: string;
  size: number;
  engine: string;
  storage?: string;
  env: string;
  median: number;
  p75: number;
  p99: number;
  samples: number;
  error?: string;
}

export interface EngineMeta {
  name: string;
  packageName: string;
  storage?: string;
  durability?: string;
  notes: string;
}

export interface ChildOutput {
  rows: ResultRow[];
  signatures: Record<string, string>;
  engine: EngineMeta;
}

export interface Machine {
  cpu: string;
  cores: number;
  memoryGb: number;
  os: string;
}

export interface RunFile {
  kind: 'node' | 'browser';
  date: string;
  commit: string;
  machine: Machine;
  runtimes: Record<string, string>;
  versions: Record<string, string>;
  engines: EngineMeta[];
  rows: ResultRow[];
}

export function errorRow(
  base: Omit<ResultRow, 'median' | 'p75' | 'p99' | 'samples'>,
  error: unknown,
): ResultRow {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...base,
    median: Number.NaN,
    p75: Number.NaN,
    p99: Number.NaN,
    samples: 0,
    error: message,
  };
}
