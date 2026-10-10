// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
export class ExactIndex {
  index: { [key: string]: any[] | undefined };
  field: string;

  constructor(exactField: string) {
    this.index = Object.create(null);
    this.field = exactField;
  }

  // add the value you want returned to the key in the index
  set(key: any, val: any): void {
    if (this.index[key]) {
      (this.index[key] as any[]).push(val);
    } else {
      this.index[key] = [val];
    }
  }

  // remove the value from the index, if the value was the last one, remove the key
  remove(key: any, val: any): void {
    const idxSet = this.index[key] as any[];
    for (const i in idxSet) {
      if (idxSet[i] == val) {
        idxSet.splice(i as unknown as number, 1);
      }
    }
    if (idxSet.length < 1) {
      this.index[key] = undefined;
    }
  }

  // get the values related to the key, could be more than one
  get(key: any): any[] | undefined {
    return this.index[key];
  }

  // clear will zap the index
  clear(_key?: any): void {
    this.index = {};
  }
}
