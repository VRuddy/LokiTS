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

describe('KeyValueStore isolation', () => {
  it('does not share keys between stores', () => {
    const first = new loki.KeyValueStore();
    const second = new loki.KeyValueStore();

    first.set('a', 1);

    expect(second.keys).toEqual([]);
  });

  it('keeps keys sorted and overwrites an existing key', () => {
    const store = new loki.KeyValueStore();

    store.set('b', 2);
    store.set('a', 1);
    store.set('b', 3);

    expect(store.keys).toEqual(['a', 'b']);
    expect(store.values).toEqual([1, 3]);
  });

  it('uses a custom sort for both set and get', () => {
    const store = new loki.KeyValueStore();
    store.setSort((a: number, b: number) => b - a);

    store.set(1, 'one');
    store.set(3, 'three');
    store.set(2, 'two');

    expect(store.keys).toEqual([3, 2, 1]);
    expect(store.get(2)).toBe('two');
  });
});
