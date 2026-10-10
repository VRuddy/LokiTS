// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { BSonSort, binarySearch } from './BinaryIndex';

export class KeyValueStore {
  keys!: any[];
  values!: any[];
  sort!: (a: any, b: any) => number;
  bs!: (...args: any[]) => any;

  setSort(fun: (a: any, b: any) => number): void {
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

// Defaults live on the prototype (shared state), exactly as in the original implementation.
KeyValueStore.prototype.keys = [];
KeyValueStore.prototype.values = [];
KeyValueStore.prototype.sort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
KeyValueStore.prototype.bs = function (this: KeyValueStore) {
  return BSonSort(this.sort);
};
