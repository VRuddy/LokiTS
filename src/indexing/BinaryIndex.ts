// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
export interface BinarySearchResult {
  found: boolean;
  index: number;
}

export function binarySearch(
  array: any[],
  item: any,
  fun: (a: any, b: any) => number,
): BinarySearchResult {
  let lo = 0;
  let hi = array.length;
  let compared: number;
  let mid: number;
  while (lo < hi) {
    mid = (lo + hi) >> 1;
    compared = fun.apply(null, [item, array[mid]]);
    if (compared === 0) {
      return {
        found: true,
        index: mid,
      };
    } else if (compared < 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return {
    found: false,
    index: hi,
  };
}

export function BSonSort(fun: (a: any, b: any) => number) {
  return (array: any[], item: any): BinarySearchResult => binarySearch(array, item, fun);
}
