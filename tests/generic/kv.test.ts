import { describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

describe('kv', () => {
  it('works', () => {
    var store = new loki.KeyValueStore();
    var key = {
        name: 'joe',
      },
      value = {
        position: 'developer',
      };

    store.set('foo', 'bar');
    store.set('bar', 'baz');
    store.set('baz', 'quux');
    store.set(key, value);
    expect('bar').toEqual(store.get('foo'));
    expect(value).toEqual(store.get(key));
  });
});
