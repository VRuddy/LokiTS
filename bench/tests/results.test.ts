import { describe, expect, it } from 'vitest';
import { errorRow } from '../src/core/results.ts';

const base = { family: 'memory' as const, scenario: 's', size: 1, engine: 'e', env: 'node' };

describe('errorRow', () => {
  it('keeps the message of an Error', () => {
    expect(errorRow(base, new Error('boom')).error).toBe('boom');
  });

  it('describes errors that are plain objects or events', () => {
    expect(errorRow(base, { success: false, code: 'X' }).error).toBe(
      '{"success":false,"code":"X"}',
    );
    expect(errorRow(base, 'oops').error).toBe('oops');
  });
});
