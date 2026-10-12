import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import type { Machine } from './core/results.ts';

const BENCH_ROOT = new URL('../', import.meta.url);
const MEASURED = [
  '@lokits/core',
  'lokijs',
  '@lokidb/loki',
  '@lokidb/fs-storage',
  '@lokidb/indexed-storage',
  'tinybase',
  'rxdb',
  'dexie',
  '@sqlite.org/sqlite-wasm',
  'mitata',
];

export function machineInfo(): Machine {
  const cpuList = cpus();
  return {
    cpu: cpuList[0]?.model.trim() ?? 'unknown',
    cores: cpuList.length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}`,
  };
}

export function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function packageVersions(): Record<string, string> {
  const versions: Record<string, string> = {
    'node:sqlite (SQLite)': process.versions.sqlite ?? 'n/a',
  };
  for (const name of MEASURED) {
    const file = new URL(`node_modules/${name}/package.json`, BENCH_ROOT);
    versions[name] = (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
  }
  return versions;
}
