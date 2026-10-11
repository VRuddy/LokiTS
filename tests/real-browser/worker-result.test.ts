import { expect, it } from 'vitest';
import { workerResult } from './worker-result';

it('fails fast when a worker cannot load', async () => {
  const url = URL.createObjectURL(
    new Blob(['this is not ( javascript'], { type: 'text/javascript' }),
  );
  const worker = new Worker(url);
  try {
    await expect(workerResult(worker)).rejects.toThrow('worker failed');
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}, 2_000);
