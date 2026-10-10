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
 * `onSuccess` runs after the callback and before the returned promise resolves.
 */
export function settle<T = void>(
  promise: Promise<T>,
  callback?: (err?: any) => void,
  onSuccess?: (value: T) => void,
): Promise<void> {
  if (!callback && !onSuccess) {
    return promise as Promise<void>;
  }
  return promise.then(
    (value) => {
      if (callback) {
        invoke(callback);
      }
      if (onSuccess) {
        invoke(onSuccess, value);
      }
    },
    callback ? (err) => invoke(callback, err) : undefined,
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
