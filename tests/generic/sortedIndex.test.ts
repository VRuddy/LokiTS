import { describe, expect, it } from 'vitest';
import { SortedIndex } from '../../src/indexing/SortedIndex';

describe('SortedIndex', () => {
  it('groups values by key and does not share state between indexes', () => {
    const index = new SortedIndex('age');
    const other = new SortedIndex('age');

    index.set(30, 'a');
    index.set(20, 'b');
    index.set(30, 'c');

    expect(index.keys).toEqual([20, 30]);
    expect(index.get(30)).toEqual(['a', 'c']);
    expect(other.keys).toEqual([]);
  });

  it('applies a custom sort', () => {
    const index = new SortedIndex('age');
    index.setSort((a, b) => b - a);

    index.set(1, 'x');
    index.set(3, 'y');
    index.set(2, 'z');

    expect(index.keys).toEqual([3, 2, 1]);
  });
});
