export type AdapterErrorCode = 'ENOTSUP' | 'EQUOTA' | 'EBUSY' | 'EINVAL' | 'ENOENT';

export function adapterError(
  code: AdapterErrorCode,
  message: string,
  cause?: unknown,
): Error & { code: AdapterErrorCode } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

const DOM_CODES: Record<string, AdapterErrorCode> = {
  QuotaExceededError: 'EQUOTA',
  // Firefox before 2020 reported a full localStorage under this name
  NS_ERROR_DOM_QUOTA_REACHED: 'EQUOTA',
  NoModificationAllowedError: 'EBUSY',
  NotFoundError: 'ENOENT',
  SecurityError: 'ENOTSUP',
  NotSupportedError: 'ENOTSUP',
  TypeMismatchError: 'EINVAL',
};

/**
 * `extraCodes` adds context-specific names that are not safe to map globally, e.g. WebKit reports an OPFS
 * file held by a sync access handle as InvalidStateError, which IndexedDB uses for closing connections.
 */
export function translateDomError(
  err: unknown,
  context: string,
  extraCodes?: Record<string, AdapterErrorCode>,
): unknown {
  const name = (err as { name?: unknown } | null)?.name;
  const code = typeof name === 'string' ? (extraCodes?.[name] ?? DOM_CODES[name]) : undefined;
  if (!code) {
    return err;
  }
  const message = (err as { message?: string }).message || name;
  return adapterError(code, `${context}: ${message}`, err);
}
