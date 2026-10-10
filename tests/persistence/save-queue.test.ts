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

  it('lock releases even when fn fails, and later saves run', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);

    await expect(
      queue.lock(async () => {
        throw new Error('bad json');
      }),
    ).rejects.toThrow('bad json');
    expect(queue.busy).toBe(false);

    const save = queue.save();
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await save;
  });

  it('cancels the saves queued during a lock whose fn fails', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    const loadError = new Error('bad json');
    let fail!: () => void;

    const locked = queue.lock(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = () => reject(loadError);
        }),
    );
    const first = queue.save();
    const second = queue.save();
    const rejections = Promise.all([first, second].map((save) => save.catch((err) => err)));

    fail();
    await expect(locked).rejects.toBe(loadError);
    const [firstError, secondError] = await rejections;

    expect(pending).toHaveLength(0);
    for (const err of [firstError, secondError]) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('save cancelled: the database failed to load');
      expect(err.cause).toBe(loadError);
    }
    expect(queue.busy).toBe(false);

    const later = queue.save();
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await later;
  });

  it('a lock failing keeps the save that was already queued behind a running save', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    let fail!: () => void;

    const running = queue.save();
    const queued = queue.save();
    const locked = queue.lock(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = () => reject(new Error('bad json'));
        }),
    );
    const cancelled = queue.save().catch((err) => err);

    fail();
    await expect(locked).rejects.toThrow('bad json');
    expect((await cancelled).message).toBe('save cancelled: the database failed to load');

    pending[0].resolve();
    await running;
    pending[1].resolve();
    await expect(queued).resolves.toBeUndefined();
  });

  it('a lock taken during a save does not start the queued save before the first ends', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    let release!: () => void;

    const a = queue.save();
    const locked = queue.lock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const b = queue.save();
    const drained = queue.drain();
    let drainedDone = false;
    drained.then(() => {
      drainedDone = true;
    });

    release();
    await locked;
    await tick();
    expect(pending).toHaveLength(1);
    expect(queue.busy).toBe(true);
    expect(drainedDone).toBe(false);

    pending[0].resolve();
    await a;
    expect(pending).toHaveLength(2);

    let bDone = false;
    b.then(() => {
      bDone = true;
    });
    await tick();
    expect(bDone).toBe(false);

    pending[1].resolve();
    await b;
    await expect(drained).resolves.toBe(true);
  });

  it('overlapping locks keep saves back until the last one is released', async () => {
    const { run, pending } = controlledRun();
    const queue = new SaveQueue(run, () => true);
    let release1!: () => void;
    let release2!: () => void;

    const lock1 = queue.lock(
      () =>
        new Promise<void>((resolve) => {
          release1 = resolve;
        }),
    );
    const lock2 = queue.lock(
      () =>
        new Promise<void>((resolve) => {
          release2 = resolve;
        }),
    );
    const save = queue.save();

    release1();
    await lock1;
    await tick();
    expect(pending).toHaveLength(0);
    expect(queue.busy).toBe(true);

    release2();
    await lock2;
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await save;
    expect(queue.busy).toBe(false);
  });

  it('a run that throws synchronously rejects the save and does not jam the queue', async () => {
    let calls = 0;
    const queue = new SaveQueue(
      () => {
        calls++;
        if (calls === 1) {
          throw new Error('sync boom');
        }
        return Promise.resolve();
      },
      () => true,
    );

    const first = queue.save();
    await expect(first).rejects.toThrow('sync boom');
    expect(queue.busy).toBe(false);

    await expect(queue.save()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('when not throttled, a run that throws synchronously yields a rejected promise', async () => {
    const queue = new SaveQueue(
      () => {
        throw new Error('sync boom');
      },
      () => false,
    );

    let promise!: Promise<void>;
    expect(() => {
      promise = queue.save();
    }).not.toThrow();
    await expect(promise).rejects.toThrow('sync boom');
  });
});
