import { describe, expect, it, vi } from 'vitest';
import { invoke, settle, withAdapterCallback } from '../../src/persistence/callbacks';

describe('settle', () => {
  it('returns the promise untouched without a callback', async () => {
    const failing = Promise.reject(new Error('x'));
    await expect(settle(failing)).rejects.toThrow('x');
  });

  it('passes the error to the callback and never rejects', async () => {
    const seen: unknown[] = [];
    await expect(
      settle(Promise.reject(new Error('x')), (err) => seen.push(err)),
    ).resolves.toBeUndefined();
    await settle(Promise.resolve(), (err) => seen.push(err));
    expect((seen[0] as Error).message).toBe('x');
    expect(seen[1]).toBeUndefined();
  });
});

describe('invoke', () => {
  it('rethrows a callback exception outside the promise chain', () => {
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      expect(fn).toThrow('user bug');
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    invoke(() => {
      throw new Error('user bug');
    });
    expect(timers).toHaveBeenCalledOnce();
    timers.mockRestore();
  });
});

describe('withAdapterCallback', () => {
  it('gives load callbacks the value and resolves it', async () => {
    const seen: unknown[] = [];
    await expect(
      withAdapterCallback(Promise.resolve('data'), (v) => seen.push(v), 'load'),
    ).resolves.toBe('data');
    expect(seen).toEqual(['data']);
  });

  it('gives write callbacks nothing on success and the error on failure', async () => {
    const seen: unknown[] = [];
    await withAdapterCallback(Promise.resolve(), (v) => seen.push(v), 'write');
    await expect(
      withAdapterCallback(Promise.reject(new Error('x')), (v) => seen.push(v), 'write'),
    ).resolves.toBeUndefined();
    expect(seen[0]).toBeUndefined();
    expect((seen[1] as Error).message).toBe('x');
  });

  it('calls back before its own promise settles', async () => {
    const order: string[] = [];
    await withAdapterCallback(Promise.resolve('v'), () => order.push('callback'), 'load').then(() =>
      order.push('promise'),
    );
    expect(order).toEqual(['callback', 'promise']);
  });

  it('returns the promise untouched without a callback', async () => {
    await expect(
      withAdapterCallback(Promise.reject(new Error('x')), undefined, 'load'),
    ).rejects.toThrow('x');
  });
});
