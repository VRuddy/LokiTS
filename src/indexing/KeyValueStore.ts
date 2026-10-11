import { BSonSort, binarySearch } from './BinaryIndex';

const defaultSort = (a: any, b: any): number => (a < b ? -1 : a > b ? 1 : 0);

export class KeyValueStore {
  keys!: any[];
  values!: any[];
  sort!: (a: any, b: any) => number;
  bs!: (...args: any[]) => any;

  constructor() {
    this.keys = [];
    this.values = [];
    this.sort = defaultSort;
    this.bs = BSonSort(defaultSort);
  }

  setSort(fun: (a: any, b: any) => number): void {
    this.sort = fun;
    this.bs = BSonSort(fun);
  }

  set(key: any, value: any): void {
    const pos = this.bs(this.keys, key);
    if (pos.found) {
      this.values[pos.index] = value;
    } else {
      this.keys.splice(pos.index, 0, key);
      this.values.splice(pos.index, 0, value);
    }
  }

  get(key: any): any {
    return this.values[binarySearch(this.keys, key, this.sort).index];
  }
}
