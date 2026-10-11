import { Utils } from '../utils/helpers';

// wrapping in object to expose to default export for potential user override.
// warning: overriding these methods will override behavior for all loki db instances in memory.
// warning: if you use binary indices these comparators should be the same for all inserts/updates/removes.
export const Comparators: {
  aeq: (prop1: any, prop2: any) => boolean;
  lt: (prop1: any, prop2: any, equal?: boolean) => boolean;
  gt: (prop1: any, prop2: any, equal?: boolean) => boolean;
} = {
  aeq: aeqHelper,
  lt: ltHelper,
  gt: gtHelper,
};

export function aeqHelper(prop1: any, prop2: any): boolean {
  let cv1: any;
  let cv2: any;
  let t1: number;
  let t2: number;

  if (prop1 === prop2) return true;

  // 'falsy' and Boolean handling
  if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
    // dates and NaN conditions (typed dates before serialization)
    switch (prop1) {
      case undefined:
        t1 = 1;
        break;
      case null:
        t1 = 1;
        break;
      case false:
        t1 = 3;
        break;
      case true:
        t1 = 4;
        break;
      case '':
        t1 = 5;
        break;
      default:
        t1 = prop1 === prop1 ? 9 : 0;
        break;
    }

    switch (prop2) {
      case undefined:
        t2 = 1;
        break;
      case null:
        t2 = 1;
        break;
      case false:
        t2 = 3;
        break;
      case true:
        t2 = 4;
        break;
      case '':
        t2 = 5;
        break;
      default:
        t2 = prop2 === prop2 ? 9 : 0;
        break;
    }

    // one or both is edge case
    if (t1 !== 9 || t2 !== 9) {
      return t1 === t2;
    }
  }

  // Handle 'Number-like' comparisons
  cv1 = Number(prop1);
  cv2 = Number(prop2);

  // if one or both are 'number-like'...
  if (cv1 === cv1 || cv2 === cv2) {
    return cv1 === cv2;
  }

  // not strict equal nor less than nor gt so must be mixed types, convert to string and use that to compare
  cv1 = prop1.toString();
  cv2 = prop2.toString();

  return cv1 == cv2;
}

/** Helper function for determining 'less-than' conditions for ops, sorting, and binary indices.
 *     In the future we might want $lt and $gt ops to use their own functionality/helper.
 *     Since binary indices on a property might need to index [12, NaN, new Date(), Infinity], we
 *     need this function (as well as gtHelper) to always ensure one value is LT, GT, or EQ to another.
 */
export function ltHelper(prop1: any, prop2: any, equal?: boolean): boolean {
  let cv1: any;
  let cv2: any;
  let t1: number;
  let t2: number;

  // if one of the params is falsy or strictly true or not equal to itself
  // 0, 0.0, "", NaN, null, undefined, not defined, false, true
  if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
    switch (prop1) {
      case undefined:
        t1 = 1;
        break;
      case null:
        t1 = 1;
        break;
      case false:
        t1 = 3;
        break;
      case true:
        t1 = 4;
        break;
      case '':
        t1 = 5;
        break;
      // if strict equal probably 0 so sort higher, otherwise probably NaN so sort lower than even null
      default:
        t1 = prop1 === prop1 ? 9 : 0;
        break;
    }

    switch (prop2) {
      case undefined:
        t2 = 1;
        break;
      case null:
        t2 = 1;
        break;
      case false:
        t2 = 3;
        break;
      case true:
        t2 = 4;
        break;
      case '':
        t2 = 5;
        break;
      default:
        t2 = prop2 === prop2 ? 9 : 0;
        break;
    }

    // one or both is edge case
    if (t1 !== 9 || t2 !== 9) {
      return t1 === t2 ? (equal as boolean) : t1 < t2;
    }
  }

  // if both are numbers (string encoded or not), compare as numbers
  cv1 = Number(prop1);
  cv2 = Number(prop2);

  if (cv1 === cv1 && cv2 === cv2) {
    if (cv1 < cv2) return true;
    if (cv1 > cv2) return false;
    return equal as boolean;
  }

  if (cv1 === cv1 && cv2 !== cv2) {
    return true;
  }

  if (cv2 === cv2 && cv1 !== cv1) {
    return false;
  }

  if (prop1 < prop2) return true;
  if (prop1 > prop2) return false;
  if (prop1 == prop2) return equal as boolean;

  // not strict equal nor less than nor gt so must be mixed types, convert to string and use that to compare
  cv1 = prop1.toString();
  cv2 = prop2.toString();

  if (cv1 < cv2) {
    return true;
  }

  if (cv1 == cv2) {
    return equal as boolean;
  }

  return false;
}

export function gtHelper(prop1: any, prop2: any, equal?: boolean): boolean {
  let cv1: any;
  let cv2: any;
  let t1: number;
  let t2: number;

  // 'falsy' and Boolean handling
  if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
    switch (prop1) {
      case undefined:
        t1 = 1;
        break;
      case null:
        t1 = 1;
        break;
      case false:
        t1 = 3;
        break;
      case true:
        t1 = 4;
        break;
      case '':
        t1 = 5;
        break;
      // NaN 0
      default:
        t1 = prop1 === prop1 ? 9 : 0;
        break;
    }

    switch (prop2) {
      case undefined:
        t2 = 1;
        break;
      case null:
        t2 = 1;
        break;
      case false:
        t2 = 3;
        break;
      case true:
        t2 = 4;
        break;
      case '':
        t2 = 5;
        break;
      default:
        t2 = prop2 === prop2 ? 9 : 0;
        break;
    }

    // one or both is edge case
    if (t1 !== 9 || t2 !== 9) {
      return t1 === t2 ? (equal as boolean) : t1 > t2;
    }
  }

  // if both are numbers (string encoded or not), compare as numbers
  cv1 = Number(prop1);
  cv2 = Number(prop2);
  if (cv1 === cv1 && cv2 === cv2) {
    if (cv1 > cv2) return true;
    if (cv1 < cv2) return false;
    return equal as boolean;
  }

  if (cv1 === cv1 && cv2 !== cv2) {
    return false;
  }

  if (cv2 === cv2 && cv1 !== cv1) {
    return true;
  }

  if (prop1 > prop2) return true;
  if (prop1 < prop2) return false;
  if (prop1 == prop2) return equal as boolean;

  // not strict equal nor less than nor gt so must be dates or mixed types
  // convert to string and use that to compare
  cv1 = prop1.toString();
  cv2 = prop2.toString();

  if (cv1 > cv2) {
    return true;
  }

  if (cv1 == cv2) {
    return equal as boolean;
  }

  return false;
}

export function sortHelper(prop1: any, prop2: any, desc?: boolean): number {
  if (Comparators.aeq(prop1, prop2)) return 0;

  if (Comparators.lt(prop1, prop2, false)) {
    return desc ? 1 : -1;
  }

  if (Comparators.gt(prop1, prop2, false)) {
    return desc ? -1 : 1;
  }

  // not lt, not gt so implied equality-- date compatible
  return 0;
}

/**
 * compoundeval() - helper function for compoundsort(), performing individual object comparisons
 *
 * @param properties - array of property names, in order, by which to evaluate sort order
 * @param obj1 - first object to compare
 * @param obj2 - second object to compare
 * @returns 0, -1, or 1 to designate if identical (sortwise) or which should be first
 */
export function compoundeval(properties: Array<[string, boolean]>, obj1: any, obj2: any): number {
  let res = 0;
  let prop: [string, boolean];
  let field: string;
  let val1: any;
  let val2: any;
  let arr: string[];
  for (let i = 0, len = properties.length; i < len; i++) {
    prop = properties[i];
    field = prop[0];
    if (~field.indexOf('.')) {
      arr = field.split('.');
      val1 = Utils.getIn(obj1, arr, true);
      val2 = Utils.getIn(obj2, arr, true);
    } else {
      val1 = obj1[field];
      val2 = obj2[field];
    }
    res = sortHelper(val1, val2, prop[1]);
    if (res !== 0) {
      return res;
    }
  }
  return 0;
}
