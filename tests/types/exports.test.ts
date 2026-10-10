import { describe, expect, expectTypeOf, it } from 'vitest';
import loki, * as api from '../../src';
import { type Collection, Loki } from '../../src';

describe('public exports', () => {
  it('exposes the static members of the original module with types', () => {
    expectTypeOf(loki.Collection).toEqualTypeOf<typeof Collection>();
    expectTypeOf(loki.persistenceAdapters.fs).toEqualTypeOf<typeof api.LokiFsAdapter>();
    expectTypeOf(loki.aeq).toBeFunction();
    expect(loki.LokiOps.$eq(1, 1)).toBe(true);
    expect(new loki('x')).toBeInstanceOf(Loki);
  });

  it('does not leak internal helpers', () => {
    const names = Object.keys(api);

    for (const internal of [
      'add',
      'sub',
      'median',
      'hasOwn',
      'binarySearch',
      'ensureBinaryIndex',
    ]) {
      expect(names).not.toContain(internal);
    }
    expect(names).toEqual(expect.arrayContaining(['Loki', 'Collection', 'loki', 'default']));
  });
});
