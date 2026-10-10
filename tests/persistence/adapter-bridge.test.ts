import { describe, expect, it } from 'vitest';
import { callAdapter } from '../../src/persistence/adapter-bridge';

describe('callAdapter', () => {
  it('follows the callback of a callback adapter', async () => {
    const adapter = {
      load: (_n: string, cb: (v: unknown) => void) => setTimeout(() => cb('data'), 1),
    };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).resolves.toBe('data');
  });

  it('follows the promise of a promise adapter', async () => {
    const adapter = { load: async () => 'data' };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).resolves.toBe('data');
  });

  it('settles once, on the first of callback and promise', async () => {
    const adapter = {
      load: (_n: string, cb: (v: unknown) => void) => {
        cb(new Error('first'));
        return Promise.resolve('second');
      },
    };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).rejects.toThrow('first');
  });

  it('follows only the callback of a method that declares it, whatever it returns', async () => {
    const adapter = {
      load: (_n: string, cb: (v: unknown) => void) =>
        Promise.resolve().then(() => {
          setTimeout(() => cb('data'), 5);
        }),
      save: (_n: string, _d: string, cb: (e?: unknown) => void) =>
        Promise.resolve().then(() => {
          setTimeout(() => cb(new Error('disk')), 5);
        }),
    };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).resolves.toBe('data');
    await expect(callAdapter(adapter, 'save', ['db', 'x'], 'write')).rejects.toThrow('disk');
  });

  it('follows the first to settle when the method does not declare a callback', async () => {
    const adapter = {
      load: (...args: unknown[]) => {
        const cb = args[args.length - 1] as (v: unknown) => void;
        setTimeout(() => cb('late callback'), 20);
        return new Promise((resolve) => setTimeout(() => resolve('early promise'), 1));
      },
    };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).resolves.toBe('early promise');
  });

  it('rejects when the promise of a callback-declaring method rejects', async () => {
    const adapter = {
      load: async (_n: string, _cb: (v: unknown) => void) => {
        throw new Error('async');
      },
    };
    await expect(callAdapter(adapter, 'load', ['db'], 'load')).rejects.toThrow('async');
  });

  it('ignores a callback called twice', async () => {
    const adapter = {
      save: (_n: string, _d: string, cb: (e?: unknown) => void) => {
        cb();
        cb(new Error('late'));
      },
    };
    await expect(callAdapter(adapter, 'save', ['db', 'x'], 'write')).resolves.toBeUndefined();
  });

  it('turns a synchronous throw and a rejected promise into a rejection', async () => {
    const throwing = {
      load: () => {
        throw new Error('sync');
      },
    };
    const rejecting = {
      load: async () => {
        throw new Error('async');
      },
    };
    await expect(callAdapter(throwing, 'load', ['db'], 'load')).rejects.toThrow('sync');
    await expect(callAdapter(rejecting, 'load', ['db'], 'load')).rejects.toThrow('async');
  });

  it('maps load results', async () => {
    const answer = (value: unknown) => ({
      load: (_n: string, cb: (v: unknown) => void) => cb(value),
    });
    await expect(callAdapter(answer(null), 'load', ['db'], 'load')).resolves.toBeNull();
    await expect(callAdapter(answer(undefined), 'load', ['db'], 'load')).resolves.toBeUndefined();
    await expect(callAdapter(answer({ a: 1 }), 'load', ['db'], 'load')).resolves.toEqual({ a: 1 });
    await expect(callAdapter(answer(new Error('io')), 'load', ['db'], 'load')).rejects.toThrow(
      'io',
    );
  });

  it('maps write results', async () => {
    const answer = (value: unknown) => ({
      save: (_n: string, cb: (v: unknown) => void) => cb(value),
    });
    for (const ok of [undefined, null, false, { success: true }]) {
      await expect(callAdapter(answer(ok), 'save', ['db'], 'write')).resolves.toBeUndefined();
    }
    const failure = { success: false };
    await expect(callAdapter(answer(failure), 'save', ['db'], 'write')).rejects.toBe(failure);
    await expect(callAdapter(answer('oops'), 'save', ['db'], 'write')).rejects.toBe('oops');
    await expect(callAdapter(answer(new Error('x')), 'save', ['db'], 'write')).rejects.toThrow('x');
  });

  it('rejects when the method does not exist', async () => {
    await expect(callAdapter({}, 'deleteDatabase', ['db'], 'write')).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
