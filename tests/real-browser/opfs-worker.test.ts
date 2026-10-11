import { expect, it } from 'vitest';

it('runs LokiOpfsAdapter in a dedicated worker and reports a locked file', async () => {
  const worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<{ count?: number; lockedCode?: string; error?: string }>(
      (resolve) => {
        worker.onmessage = (event) => resolve(event.data);
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(2);
    expect(result.lockedCode).toBe('EBUSY');
  } finally {
    worker.terminate();
  }
});
