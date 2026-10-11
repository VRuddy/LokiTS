import { hasOwn } from '../utils/helpers';
import { Comparators } from './comparators';

/**
 * dotSubScan - helper function used for dot notation queries.
 *
 * @param root - object to traverse
 * @param paths - array of properties to drill into
 * @param fun - evaluation function to test with
 * @param value - comparative value to also pass to (compare) fun
 * @param extra - extra arg to also pass to compare fun
 * @param poffset - index of the item in 'paths' to start the sub-scan from
 */
export function dotSubScan(
  root: any,
  paths: string[],
  fun: (element: any, value: any, extra: any) => boolean,
  value: any,
  extra: any,
  poffset?: number,
): boolean {
  const pathOffset = poffset || 0;
  const path = paths[pathOffset];

  let valueFound = false;
  let element: any;
  if (root !== null && typeof root === 'object' && path in root) {
    element = root[path];
  }
  if (pathOffset + 1 >= paths.length) {
    // if we have already expanded out the dot notation,
    // then just evaluate the test function and value on the element
    valueFound = fun(element, value, extra);
  } else if (Array.isArray(element)) {
    for (let index = 0, len = element.length; index < len; index += 1) {
      valueFound = dotSubScan(element[index], paths, fun, value, extra, pathOffset + 1);
      if (valueFound === true) {
        break;
      }
    }
  } else {
    valueFound = dotSubScan(element, paths, fun, value, extra, pathOffset + 1);
  }

  return valueFound;
}

export function containsCheckFn(a: any): ((b: any) => boolean) | null {
  if (typeof a === 'string' || Array.isArray(a)) {
    return (b: any) => a.indexOf(b) !== -1;
  } else if (typeof a === 'object' && a !== null) {
    return (b: any) => hasOwn.call(a, b);
  }
  return null;
}

export function doQueryOp(val: any, op: any, record?: any): boolean {
  for (const p in op) {
    if (hasOwn.call(op, p)) {
      return LokiOps[p](val, op[p], record);
    }
  }
  return false;
}

export const LokiOps: { [op: string]: (a: any, b: any, record?: any) => boolean } = {
  // comparison operators
  // a is the value in the collection
  // b is the query value
  $eq: (a, b) => a === b,

  // abstract/loose equality
  $aeq: (a, b) => a == b,

  $ne: (a, b) => {
    // ecma 5 safe test for NaN
    if (b !== b) {
      // ecma 5 test value is not NaN
      return a === a;
    }

    return a !== b;
  },
  // date equality / loki abstract equality test
  $dteq: (a, b) => Comparators.aeq(a, b),

  // loki comparisons: return identical unindexed results as indexed comparisons
  $gt: (a, b) => Comparators.gt(a, b, false),

  $gte: (a, b) => Comparators.gt(a, b, true),

  $lt: (a, b) => Comparators.lt(a, b, false),

  $lte: (a, b) => Comparators.lt(a, b, true),

  // lightweight javascript comparisons
  $jgt: (a, b) => a > b,

  $jgte: (a, b) => a >= b,

  $jlt: (a, b) => a < b,

  $jlte: (a, b) => a <= b,

  // ex : coll.find({'orderCount': {$between: [10, 50]}});
  $between: (a, vals) => {
    if (a === undefined || a === null) return false;
    return Comparators.gt(a, vals[0], true) && Comparators.lt(a, vals[1], true);
  },

  $jbetween: (a, vals) => {
    if (a === undefined || a === null) return false;
    return a >= vals[0] && a <= vals[1];
  },

  $in: (a, b) => b.indexOf(a) !== -1,

  $inSet: (a, b) => b.has(a),

  $nin: (a, b) => b.indexOf(a) === -1,

  $keyin: (a, b) => a in b,

  $nkeyin: (a, b) => !(a in b),

  $definedin: (a, b) => b[a] !== undefined,

  $undefinedin: (a, b) => b[a] === undefined,

  $regex: (a, b) => b.test(a),

  $containsString: (a, b) => typeof a === 'string' && a.indexOf(b) !== -1,

  $containsNone: (a, b) => !LokiOps.$containsAny(a, b),

  $containsAny: (a, b) => {
    const checkFn = containsCheckFn(a);
    if (checkFn !== null) {
      return Array.isArray(b) ? b.some(checkFn) : checkFn(b);
    }
    return false;
  },

  $contains: (a, b) => {
    const checkFn = containsCheckFn(a);
    if (checkFn !== null) {
      return Array.isArray(b) ? b.every(checkFn) : checkFn(b);
    }
    return false;
  },

  $elemMatch: (a, b) => {
    if (Array.isArray(a)) {
      return a.some((item) =>
        Object.keys(b).every((property) => {
          let filter = b[property];
          if (!(typeof filter === 'object' && filter)) {
            filter = { $eq: filter };
          }

          if (property.indexOf('.') !== -1) {
            return dotSubScan(item, property.split('.'), doQueryOp, b[property], item);
          }
          return doQueryOp(item[property], filter, item);
        }),
      );
    }
    return false;
  },

  $type: (a, b, record) => {
    let type: string = typeof a;
    if (type === 'object') {
      if (Array.isArray(a)) {
        type = 'array';
      } else if (a instanceof Date) {
        type = 'date';
      }
    }
    return typeof b !== 'object' ? type === b : doQueryOp(type, b, record);
  },

  $finite: (a, b) => b === isFinite(a),

  $size: (a, b, record) => {
    if (Array.isArray(a)) {
      return typeof b !== 'object' ? a.length === b : doQueryOp(a.length, b, record);
    }
    return false;
  },

  $len: (a, b, record) => {
    if (typeof a === 'string') {
      return typeof b !== 'object' ? a.length === b : doQueryOp(a.length, b, record);
    }
    return false;
  },

  $where: (a, b) => b(a) === true,

  // field-level logical operators
  // a is the value in the collection
  // b is the nested query operation (for '$not')
  //   or an array of nested query operations (for '$and' and '$or')
  $not: (a, b, record) => !doQueryOp(a, b, record),

  $and: (a, b, record) => {
    for (let idx = 0, len = b.length; idx < len; idx += 1) {
      if (!doQueryOp(a, b[idx], record)) {
        return false;
      }
    }
    return true;
  },

  $or: (a, b, record) => {
    for (let idx = 0, len = b.length; idx < len; idx += 1) {
      if (doQueryOp(a, b[idx], record)) {
        return true;
      }
    }
    return false;
  },

  $exists: (a, b) => {
    if (b) {
      return a !== undefined;
    } else {
      return a === undefined;
    }
  },
};

// ops that can be used with { $$op: 'column-name' } syntax
export const valueLevelOps: string[] = [
  '$eq',
  '$aeq',
  '$ne',
  '$dteq',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$jgt',
  '$jgte',
  '$jlt',
  '$jlte',
  '$type',
];
valueLevelOps.forEach((op) => {
  const fun = LokiOps[op];
  LokiOps[`$${op}`] = (a, spec, record) => {
    if (typeof spec === 'string') {
      return fun(a, record[spec]);
    } else if (typeof spec === 'function') {
      return fun(a, spec(record));
    } else {
      throw new Error('Invalid argument to $$ matcher');
    }
  };
});

// if an op is registered in this object, our 'calculateRange' can use it with our binary indices.
// if the op is registered to a function, we will run that function/op as a 2nd pass filter on results.
// those 2nd pass filter functions should be similar to LokiOps functions, accepting 2 vals to compare.
export const indexedOps: { [op: string]: boolean | ((a: any, b: any) => boolean) } = {
  $eq: LokiOps.$eq,
  $aeq: true,
  $dteq: true,
  $gt: true,
  $gte: true,
  $lt: true,
  $lte: true,
  $in: true,
  $between: true,
};
