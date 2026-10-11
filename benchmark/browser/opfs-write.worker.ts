import { joinLines } from '../../src/adapters/lines';

const SIZES = [10_000, 100_000];
const RUNS = 5;

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: Uint8Array, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

function documents(count: number): string[] {
  return Array.from({ length: count }, (_, n) =>
    JSON.stringify({
      $loki: n + 1,
      name: `user ${n}`,
      age: n % 90,
      tags: ['a', 'b'],
      meta: { revision: 0, created: 1, version: 0 },
    }),
  );
}

async function* iterate(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) {
    yield line;
  }
}

async function time(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round((performance.now() - start) * 10) / 10;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

async function writeWritable(dir: FileSystemDirectoryHandle, name: string, lines: string[]) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  for await (const chunk of joinLines(iterate(lines))) {
    await writable.write(chunk);
  }
  await writable.close();
}

async function writeSync(dir: FileSystemDirectoryHandle, name: string, lines: string[]) {
  const handle = await dir.getFileHandle(name, { create: true });
  const access: SyncAccessHandle = await (
    handle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();
  try {
    const encoder = new TextEncoder();
    access.truncate(0);
    let at = 0;
    for await (const chunk of joinLines(iterate(lines))) {
      at += access.write(encoder.encode(chunk), { at });
    }
    access.flush();
  } finally {
    access.close();
  }
}

async function run() {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(`bench-${crypto.randomUUID()}`, { create: true });
  try {
    const results = [];
    for (const docs of SIZES) {
      const lines = documents(docs);
      const mb = +(new TextEncoder().encode(lines.join('\n')).length / 1e6).toFixed(1);
      const writable: number[] = [];
      const sync: number[] = [];
      // alternated so that neither path always runs on a warmer or colder disk
      for (let i = 0; i < RUNS; i++) {
        writable.push(await time(() => writeWritable(dir, `w${docs}-${i}`, lines)));
        sync.push(await time(() => writeSync(dir, `s${docs}-${i}`, lines)));
      }
      results.push({
        docs,
        mb,
        writable: { runs: writable, median: median(writable) },
        sync: { runs: sync, median: median(sync) },
      });
    }
    return { results };
  } finally {
    await root.removeEntry(dir.name, { recursive: true }).catch(() => {});
  }
}

run().then(
  (result) => postMessage(result),
  (err) => postMessage({ error: String(err) }),
);
