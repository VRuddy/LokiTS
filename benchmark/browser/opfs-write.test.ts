import { expect, it } from 'vitest';
import { workerResult } from '../../tests/real-browser/worker-result';

it('compares createWritable and the sync access handle in a worker', async () => {
  const worker = new Worker(new URL('./opfs-write.worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await workerResult<Record<string, unknown>>(worker);
    const engine = /Firefox/.test(navigator.userAgent)
      ? 'firefox'
      : /Chrom/.test(navigator.userAgent)
        ? 'chromium'
        : 'webkit';
    console.log(`OPFS WRITE BENCH ${engine} ${JSON.stringify(result)}`);
    expect(result.error).toBeUndefined();
  } finally {
    worker.terminate();
  }
}, 300_000);
