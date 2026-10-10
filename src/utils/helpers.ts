// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { clone } from './clone';

export const hasOwn = Object.prototype.hasOwnProperty;

export const Utils = {
  copyProperties(src: any, dest: any): void {
    let prop: string;
    for (prop in src) {
      dest[prop] = src[prop];
    }
  },
  // used to recursively scan hierarchical transform step object for param substitution
  resolveTransformObject(subObj: any, params: any, depth?: number): any {
    let prop: string;
    let pname: string;

    if (typeof depth !== 'number') {
      depth = 0;
    }

    if (++depth >= 10) return subObj;

    for (prop in subObj) {
      if (typeof subObj[prop] === 'string' && subObj[prop].indexOf('[%lktxp]') === 0) {
        pname = subObj[prop].substring(8);
        if (Object.hasOwn(params, pname)) {
          subObj[prop] = params[pname];
        }
      } else if (typeof subObj[prop] === 'object') {
        subObj[prop] = Utils.resolveTransformObject(subObj[prop], params, depth);
      }
    }

    return subObj;
  },
  // top level utility to resolve an entire (single) transform (array of steps) for parameter substitution
  resolveTransformParams(transform: any[], params?: any): any[] {
    let idx: number;
    let clonedStep: any;
    const resolvedTransform: any[] = [];

    if (typeof params === 'undefined') return transform;

    // iterate all steps in the transform array
    for (idx = 0; idx < transform.length; idx++) {
      // clone transform so our scan/replace can operate directly on cloned transform
      clonedStep = clone(transform[idx], 'shallow-recurse-objects');
      resolvedTransform.push(Utils.resolveTransformObject(clonedStep, params));
    }

    return resolvedTransform;
  },

  // By default (if usingDotNotation is false), looks up path in
  // object via `object[path]`
  //
  // If `usingDotNotation` is true, then the path is assumed to
  // represent a nested path. It can be in the form of an array of
  // field names, or a period delimited string. The function will
  // look up the value of object[path[0]], and then call
  // result[path[1]] on the result, etc etc.
  //
  // If `usingDotNotation` is true, this function still supports
  // non nested fields.
  //
  // `usingDotNotation` is a performance optimization. The caller
  // may know that a path is *not* nested. In which case, this
  // function avoids a costly string.split('.')
  //
  // examples:
  // getIn({a: 1}, "a") => 1
  // getIn({a: 1}, "a", true) => 1
  // getIn({a: {b: 1}}, ["a", "b"], true) => 1
  // getIn({a: {b: 1}}, "a.b", true) => 1
  getIn(object: any, path: string | string[], usingDotNotation?: boolean): any {
    if (object == null) {
      return undefined;
    }
    if (!usingDotNotation) {
      return object[path as string];
    }

    if (typeof path === 'string') {
      path = path.split('.');
    }

    if (!Array.isArray(path)) {
      throw new Error(`path must be a string or array. Found ${typeof path}`);
    }

    let index = 0;
    const length = path.length;

    while (object != null && index < length) {
      object = object[path[index++]];
    }
    return index && index == length ? object : undefined;
  },
};

export function localStorageAvailable(): boolean {
  try {
    return window && window.localStorage !== undefined && window.localStorage !== null;
  } catch (e) {
    return false;
  }
}

/**
 * General utils, including statistical functions
 */
export function isDeepProperty(field: string): boolean {
  return field.indexOf('.') !== -1;
}

export function parseBase10(num: any): number {
  return parseFloat(num);
}

export function isNotUndefined(obj: any): boolean {
  return obj !== undefined;
}

export function add(a: any, b: any): any {
  return a + b;
}

export function sub(a: any, b: any): any {
  return a - b;
}

export function median(values: number[]): number {
  values.sort(sub);
  const half = Math.floor(values.length / 2);
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2.0;
}

export function average(array: number[]): number {
  return array.reduce(add, 0) / array.length;
}

export function standardDeviation(values: number[]): number {
  const avg = average(values);
  const squareDiffs = values.map((value) => {
    const diff = value - avg;
    const sqrDiff = diff * diff;
    return sqrDiff;
  });

  const avgSquareDiff = average(squareDiffs);

  const stdDev = Math.sqrt(avgSquareDiff);
  return stdDev;
}

export function deepProperty(obj: any, property: string, isDeep?: boolean): any {
  if (isDeep === false) {
    // pass without processing
    return obj[property];
  }
  const pieces = property.split('.');
  let root = obj;
  while (pieces.length > 0) {
    root = root[pieces.shift() as string];
  }
  return root;
}
