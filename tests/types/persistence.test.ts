import { describe, expectTypeOf, it } from 'vitest';
import {
  type AnyLokiAdapter,
  type LegacyLokiAdapter,
  Loki,
  type LokiAdapter,
  type LokiIncrementalAdapter,
} from '../../src';

describe('adapter contracts', () => {
  it('accepts promise, incremental and legacy callback adapters', () => {
    const promiseAdapter: LokiAdapter = {
      loadDatabase: async () => null,
      saveDatabase: async () => {},
    };
    const incremental: LokiIncrementalAdapter = {
      mode: 'incremental',
      loadDatabase: async () => null,
      saveDatabase: async (_name, getLokiCopy) => {
        getLokiCopy();
      },
    };
    const legacy: LegacyLokiAdapter = {
      loadDatabase: (_name, callback) => callback(null),
      saveDatabase: (_name, _data, callback) => callback(),
    };

    for (const adapter of [promiseAdapter, incremental, legacy]) {
      expectTypeOf(adapter).toMatchTypeOf<AnyLokiAdapter>();
      new Loki('types.db', { adapter });
    }
  });
});
