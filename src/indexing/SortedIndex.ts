// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { type BinarySearchResult, BSonSort, binarySearch } from './BinaryIndex';

const defaultSort = (a: any, b: any): number => (a < b ? -1 : a > b ? 1 : 0);

export class SortedIndex {
  field: string;
  keys!: any[];
  values!: any[][];
  sort!: (a: any, b: any) => number;
  bs!: (...args: any[]) => any;

  constructor(sortedField: string) {
    this.field = sortedField;
    this.keys = [];
    this.values = [];
    this.sort = defaultSort;
    this.bs = BSonSort(defaultSort);
  }

  // and allow override of the default sort
  setSort(fun: (a: any, b: any) => number): void {
    this.sort = fun;
    this.bs = BSonSort(fun);
  }

  // add the value you want returned  to the key in the index
  set(key: any, value: any): void {
    const pos = binarySearch(this.keys, key, this.sort);
    if (pos.found) {
      this.values[pos.index].push(value);
    } else {
      this.keys.splice(pos.index, 0, key);
      this.values.splice(pos.index, 0, [value]);
    }
  }

  // get all values which have a key == the given key
  get(key: any): any[] {
    const bsr = binarySearch(this.keys, key, this.sort);
    if (bsr.found) {
      return this.values[bsr.index];
    } else {
      return [];
    }
  }

  // get all values which have a key < the given key
  getLt(key: any): any[] {
    const bsr = binarySearch(this.keys, key, this.sort);
    let pos = bsr.index;
    if (bsr.found) pos--;
    return this.getAll(key, 0, pos);
  }

  // get all values which have a key > the given key
  getGt(key: any): any[] {
    const bsr = binarySearch(this.keys, key, this.sort);
    let pos = bsr.index;
    if (bsr.found) pos++;
    return this.getAll(key, pos, this.keys.length);
  }

  // get all vals from start to end
  getAll(_key: any, start: number, end: number): any[] {
    let results: any[] = [];
    for (let i = start; i < end; i++) {
      results = results.concat(this.values[i]);
    }
    return results;
  }

  // just in case someone wants to do something smart with ranges
  getPos(key: any): BinarySearchResult {
    return binarySearch(this.keys, key, this.sort);
  }

  // remove the value from the index, if the value was the last one, remove the key
  remove(key: any, value: any): void {
    const pos = binarySearch(this.keys, key, this.sort).index;
    const idxSet = this.values[pos];
    for (const i in idxSet) {
      if (idxSet[i] == value) idxSet.splice(i as unknown as number, 1);
    }
    if (idxSet.length < 1) {
      this.keys.splice(pos, 1);
      this.values.splice(pos, 1);
    }
  }

  // clear will zap the index
  clear(): void {
    this.keys = [];
    this.values = [];
  }
}
