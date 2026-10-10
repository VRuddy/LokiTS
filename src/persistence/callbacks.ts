/** Calls a user callback; an exception it throws surfaces as an uncaught error, as it always did. */
export function invoke(callback: (...args: any[]) => unknown, ...args: unknown[]): void {
  try {
    callback(...args);
  } catch (err) {
    setTimeout(() => {
      throw err;
    }, 0);
  }
}

/**
 * Double API of Loki methods: without a callback the promise is returned as is; with one, the error goes
 * to the callback and the promise always resolves, so callback users never see an unhandled rejection.
 */
export function settle(promise: Promise<void>, callback?: (err?: any) => void): Promise<void> {
  if (!callback) {
    return promise;
  }
  return promise.then(
    () => invoke(callback),
    (err) => invoke(callback, err),
  );
}

/** Double API of adapter methods. The callback runs before the returned promise settles. */
export function withAdapterCallback<T>(
  promise: Promise<T>,
  callback: ((result?: any) => void) | undefined,
  kind: 'load' | 'write',
): Promise<T | undefined> {
  if (!callback) {
    return promise;
  }
  return promise.then(
    (value) => {
      invoke(callback, kind === 'load' ? value : undefined);
      return value;
    },
    (err) => {
      invoke(callback, err);
      return undefined;
    },
  );
}
