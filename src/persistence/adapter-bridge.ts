export type AdapterCallKind = 'load' | 'write';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

// Legacy adapters report a write as falsy (ok), an Error, or { success } (loki-indexed, incremental idb).
const isWriteSuccess = (value: unknown): boolean => {
  if (!value) {
    return true;
  }
  if (value instanceof Error) {
    return false;
  }
  return typeof value === 'object' && (value as { success?: unknown }).success === true;
};

/**
 * Calls a promise or callback adapter method and returns a promise. The adapter style is not detected:
 * a callback is always appended, and whichever of the callback and the returned promise settles first wins.
 */
export function callAdapter(
  target: object,
  method: string,
  args: unknown[],
  kind: AdapterCallKind,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (!settled) {
        settled = true;
        action();
      }
    };
    const onCallback = (value?: unknown) =>
      settle(() => {
        if (kind === 'load') {
          if (value instanceof Error) {
            reject(value);
          } else {
            resolve(value);
          }
        } else if (isWriteSuccess(value)) {
          resolve(undefined);
        } else {
          reject(value);
        }
      });

    let returned: unknown;
    try {
      const fn = (target as Record<string, unknown>)[method];
      if (typeof fn !== 'function') {
        throw new TypeError(`adapter has no ${method}() method`);
      }
      returned = fn.apply(target, [...args, onCallback]);
    } catch (err) {
      settle(() => reject(err));
      return;
    }

    if (isThenable(returned)) {
      returned.then(
        (value) => settle(() => resolve(kind === 'load' ? value : undefined)),
        (err) => settle(() => reject(err)),
      );
    }
  });
}
