import { describe, expect, it } from 'vitest';
import { SaveQueue } from '../../src/persistence/save-queue';

/** A run() whose executions are finished by the test. */
function controlledRun() {
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  const run = () =>
    new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return { run, pending };
}

const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('SaveQueue', () => {
  it('runs one save at a time and folds the others into one', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    const first = queue.save();
    const second = queue.save();
    const third = queue.save();
    expect(pending).toHaveLength(1);
    expect(queue.busy).toBe(true);

    pending[0].resolve();
    await first;
    expect(pending).toHaveLength(2);

    pending[1].resolve();
    await Promise.all([second, third]);
    expect(pending).toHaveLength(2);
    expect(queue.busy).toBe(false);
  });

  it('rejects every waiter of a failed save and keeps going', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    const first = queue.save();
    const second = queue.save();
    pending[0].reject(new Error('disk'));
    await expect(first).rejects.toThrow('disk');

    pending[1].resolve();
    await expect(second).resolves.toBeUndefined();
  });

  it('calls run directly when not throttled', () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => false);

    queue.save();
    queue.save();

    expect(pending).toHaveLength(2);
    expect(queue.busy).toBe(false);
  });

  it('drains at once when idle', async () => {
    const queue = new SaveQueue(
      async () => {},
      () => true,
    );
    await expect(queue.drain()).resolves.toBe(true);
  });

  it('drain waits for saves started by callbacks of the finished save', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    queue.save().then(() => queue.save());
    const drained = queue.drain();
    pending[0].resolve();
    await tick();
    expect(pending).toHaveLength(2);

    pending[1].resolve();
    await expect(drained).resolves.toBe(true);
  });

  it('drain gives up after recursiveWaitLimitDuration', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    const keepSaving = () => queue.save().then(keepSaving);

    keepSaving();
    const drained = queue.drain({ recursiveWaitLimit: true, recursiveWaitLimitDuration: 20 });
    for (let i = 0; i < 10; i++) {
      await tick(5);
      pending[pending.length - 1].resolve();
    }

    await expect(drained).resolves.toBe(false);
  });

  it('drain without recursiveWait returns after the current save', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    queue.save();
    queue.save();
    const drained = queue.drain({ recursiveWait: false });
    pending[0].resolve();

    await expect(drained).resolves.toBe(true);
    expect(queue.busy).toBe(true);
  });

  it('lock holds saves back and plays them once after', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    let release!: () => void;

    const locked = queue.lock(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('loaded');
        }),
    );
    const first = queue.save();
    const second = queue.save();
    expect(pending).toHaveLength(0);
    expect(queue.busy).toBe(true);

    release();
    await expect(locked).resolves.toBe('loaded');
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await Promise.all([first, second]);
  });

  it('lock releases even when fn fails', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    const locked = queue.lock(async () => {
      throw new Error('bad json');
    });
    const save = queue.save();

    await expect(locked).rejects.toThrow('bad json');
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await save;
  });
});
