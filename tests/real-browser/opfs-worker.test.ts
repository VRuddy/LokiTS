import { expect, it } from 'vitest';
import { workerResult } from './worker-result';

it('runs LokiOpfsAdapter in a dedicated worker and reports a locked file', async () => {
  const worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await workerResult<{ count?: number; lockedCode?: string; error?: string }>(
      worker,
    );
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(2);
    expect(result.lockedCode).toBe('EBUSY');
  } finally {
    worker.terminate();
  }
});
