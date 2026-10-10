import { expect } from 'vitest';

// Helpers hérités des specs Jasmine ; `message` est conservé pour compatibilité mais ignoré.
export const suite = {
  assertEqual: (_message: string, actual: unknown, expected: unknown) => {
    expect(actual).toEqual(expected);
  },
  assertNotEqual: (_message: string, actual: unknown, expected: unknown) => {
    expect(actual).not.toEqual(expected);
  },
  assertStrictEqual: (_message: string, actual: unknown, expected: unknown) => {
    expect(actual).toBe(expected);
  },
  assertNotStrictEqual: (_message: string, actual: unknown, expected: unknown) => {
    expect(actual).not.toBe(expected);
  },
  assertThrows: (_message: string, fn: () => unknown, _expected?: unknown) => {
    expect(fn).toThrow();
  },
};
