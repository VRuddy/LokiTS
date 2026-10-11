import { describe, expect, it } from 'vitest';
import { adapterError, translateDomError } from '../../src/adapters/errors';

describe('adapter errors', () => {
  it('builds an error with a code and a cause', () => {
    const cause = new Error('inner');
    const err = adapterError('EINVAL', 'bad key', cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('EINVAL');
    expect(err.message).toBe('bad key');
    expect(err.cause).toBe(cause);
  });

  it.each([
    ['QuotaExceededError', 'EQUOTA'],
    ['NS_ERROR_DOM_QUOTA_REACHED', 'EQUOTA'],
    ['NoModificationAllowedError', 'EBUSY'],
    ['NotFoundError', 'ENOENT'],
    ['SecurityError', 'ENOTSUP'],
    ['NotSupportedError', 'ENOTSUP'],
    ['TypeMismatchError', 'EINVAL'],
  ])('translates %s to %s', (name, code) => {
    const original = new DOMException('boom', name);
    const err = translateDomError(original, 'saving app.db') as Error & { code: string };
    expect(err.code).toBe(code);
    expect(err.message).toBe('saving app.db: boom');
    expect(err.cause).toBe(original);
  });

  it('returns unknown errors unchanged', () => {
    const original = new TypeError('nope');
    expect(translateDomError(original, 'ctx')).toBe(original);
    expect(translateDomError('text', 'ctx')).toBe('text');
  });

  it('leaves InvalidStateError alone unless the caller maps it', () => {
    const original = new DOMException('closing', 'InvalidStateError');
    expect(translateDomError(original, 'ctx')).toBe(original);

    const err = translateDomError(original, 'writing app.db', {
      InvalidStateError: 'EBUSY',
    }) as Error & {
      code: string;
    };
    expect(err.code).toBe('EBUSY');
    expect(err.message).toBe('writing app.db: closing');
    expect(err.cause).toBe(original);
  });

  it('lets the caller mapping take precedence over the default one', () => {
    const original = new DOMException('boom', 'NotFoundError');
    const err = translateDomError(original, 'ctx', { NotFoundError: 'EINVAL' }) as Error & {
      code: string;
    };
    expect(err.code).toBe('EINVAL');
  });
});
