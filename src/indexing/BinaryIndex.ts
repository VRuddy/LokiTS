// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import type { CheckIndexOptions, Collection, CollectionBinaryIndex } from '../core/Collection';
import { Comparators } from '../query/comparators';
import { LokiOps } from '../query/operators';
import type { LokiDocument } from '../types/document';
import { hasOwn, Utils } from '../utils/helpers';
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

export function ensureBinaryIndex<T extends object>(
  c: Collection<T>,
  property: string,
  force?: boolean,
) {
  // optional parameter to force rebuild whether flagged as dirty or not
  if (typeof force === 'undefined') {
    force = false;
  }

  if (property === null || property === undefined) {
    throw new Error('Attempting to set index without an associated property');
  }

  if (c.binaryIndices[property] && !force) {
    if (!c.binaryIndices[property].dirty) return;
  }

  // if the index is already defined and we are using adaptiveBinaryIndices and we are not forcing a rebuild, return.
  if (c.adaptiveBinaryIndices === true && Object.hasOwn(c.binaryIndices, property) && !force) {
    return;
  }

  const index: CollectionBinaryIndex = {
    name: property,
    dirty: true,
    values: c.prepareFullDocIndex(),
  };
  c.binaryIndices[property] = index;

  const wrappedComparer = ((prop: string, data: LokiDocument<T>[]) => {
    let val1: any;
    let val2: any;
    const propPath = ~prop.indexOf('.') ? prop.split('.') : false;
    return (a: number, b: number) => {
      if (propPath) {
        val1 = Utils.getIn(data[a], propPath, true);
        val2 = Utils.getIn(data[b], propPath, true);
      } else {
        val1 = (data[a] as any)[prop];
        val2 = (data[b] as any)[prop];
      }

      if (val1 !== val2) {
        if (Comparators.lt(val1, val2, false)) return -1;
        if (Comparators.gt(val1, val2, false)) return 1;
      }
      return 0;
    };
  })(property, c.data);

  index.values.sort(wrappedComparer);
  index.dirty = false;

  c.dirty = true; // for autosave scenarios
}

export function checkBinaryIndex<T extends object>(
  c: Collection<T>,
  property: string,
  options?: CheckIndexOptions,
) {
  const opts: CheckIndexOptions = options || {};
  // if 'randomSamplingFactor' specified but not 'randomSampling', assume true
  if (opts.randomSamplingFactor && opts.randomSampling !== false) {
    opts.randomSampling = true;
  }
  opts.randomSamplingFactor = opts.randomSamplingFactor || 0.1;
  if (opts.randomSamplingFactor < 0 || opts.randomSamplingFactor > 1) {
    opts.randomSamplingFactor = 0.1;
  }

  let valid = true;
  let idx: number;
  let iter: number;
  let pos: number;
  let len: number;
  let biv: number[];

  // make sure we are passed a valid binary index name
  if (!Object.hasOwn(c.binaryIndices, property)) {
    throw new Error(`called checkIndex on property without an index: ${property}`);
  }

  // if lazy indexing, rebuild only if flagged as dirty
  if (!c.adaptiveBinaryIndices) {
    c.ensureIndex(property);
  }

  biv = c.binaryIndices[property].values;
  len = biv.length;

  // if the index has an incorrect number of values
  if (len !== c.data.length) {
    if (opts.repair) {
      c.ensureIndex(property, true);
    }
    return false;
  }

  if (len === 0) {
    return true;
  }

  const usingDotNotation = property.indexOf('.') !== -1;

  if (len === 1) {
    valid = biv[0] === 0;
  } else {
    if (opts.randomSampling) {
      // validate first and last
      if (
        !LokiOps.$lte(
          Utils.getIn(c.data[biv[0]], property, usingDotNotation),
          Utils.getIn(c.data[biv[1]], property, usingDotNotation),
        )
      ) {
        valid = false;
      }
      if (
        !LokiOps.$lte(
          Utils.getIn(c.data[biv[len - 2]], property, usingDotNotation),
          Utils.getIn(c.data[biv[len - 1]], property, usingDotNotation),
        )
      ) {
        valid = false;
      }

      // if first and last positions are sorted correctly with their nearest neighbor,
      // continue onto random sampling phase...
      if (valid) {
        // # random samplings = total count * sampling factor
        iter = Math.floor((len - 1) * opts.randomSamplingFactor);

        // for each random sampling, validate that the binary index is sequenced properly
        // with next higher value.
        for (idx = 0; idx < iter - 1; idx++) {
          // calculate random position
          pos = Math.floor(Math.random() * (len - 1));
          if (
            !LokiOps.$lte(
              Utils.getIn(c.data[biv[pos]], property, usingDotNotation),
              Utils.getIn(c.data[biv[pos + 1]], property, usingDotNotation),
            )
          ) {
            valid = false;
            break;
          }
        }
      }
    } else {
      // validate that the binary index is sequenced properly
      for (idx = 0; idx < len - 1; idx++) {
        if (
          !LokiOps.$lte(
            Utils.getIn(c.data[biv[idx]], property, usingDotNotation),
            Utils.getIn(c.data[biv[idx + 1]], property, usingDotNotation),
          )
        ) {
          valid = false;
          break;
        }
      }
    }
  }

  // if incorrectly sequenced and we are to fix problems, rebuild index
  if (!valid && opts.repair) {
    c.ensureIndex(property, true);
  }

  return valid;
}

export function binaryIndexPosition<T extends object>(
  c: Collection<T>,
  dataPosition: number,
  binaryIndexName: string,
) {
  const val = Utils.getIn(c.data[dataPosition], binaryIndexName, true);
  const index = c.binaryIndices[binaryIndexName].values;

  // i think calculateRange can probably be moved to collection
  // as it doesn't seem to need resultset.  need to verify
  const range = c.calculateRange('$eq', binaryIndexName, val);

  if (range[0] === 0 && range[1] === -1) {
    // uhoh didn't find range
    return null;
  }

  const min = range[0];
  const max = range[1];

  // narrow down the sub-segment of index values
  // where the indexed property value exactly matches our
  // value and then linear scan to find exact -index- position
  for (let idx = min; idx <= max; idx++) {
    if (index[idx] === dataPosition) return idx;
  }

  // uhoh
  return null;
}

export function binaryIndexInsert<T extends object>(
  c: Collection<T>,
  dataPosition: number,
  binaryIndexName: string,
) {
  const usingDotNotation = binaryIndexName.indexOf('.') !== -1;
  const index = c.binaryIndices[binaryIndexName].values;
  let val = Utils.getIn(c.data[dataPosition], binaryIndexName, usingDotNotation);

  // If you are inserting a javascript Date value into a binary index, convert to epoch time
  if (c.serializableIndices === true && val instanceof Date) {
    (c.data[dataPosition] as any)[binaryIndexName] = val.getTime();
    val = Utils.getIn(c.data[dataPosition], binaryIndexName);
  }

  const idxPos =
    index.length === 0 ? 0 : c.calculateRangeStart(binaryIndexName, val, true, usingDotNotation);

  // insert new data index into our binary index at the proper sorted location for relevant property calculated by idxPos.
  // doing this after adjusting dataPositions so no clash with previous item at that position.
  c.binaryIndices[binaryIndexName].values.splice(idxPos, 0, dataPosition);
}

export function binaryIndexUpdate<T extends object>(
  c: Collection<T>,
  dataPosition: number,
  binaryIndexName: string,
) {
  // linear scan needed to find old position within index unless we optimize for clone scenarios later
  // within (my) node 5.6.0, the following for() loop with strict compare is -much- faster than indexOf()
  let idxPos: number;
  const index = c.binaryIndices[binaryIndexName].values;
  const len = index.length;

  for (idxPos = 0; idxPos < len; idxPos++) {
    if (index[idxPos] === dataPosition) break;
  }

  //var idxPos = c.binaryIndices[binaryIndexName].values.indexOf(dataPosition);
  c.binaryIndices[binaryIndexName].values.splice(idxPos, 1);

  //c.adaptiveBinaryIndexRemove(dataPosition, binaryIndexName, true);
  c.adaptiveBinaryIndexInsert(dataPosition, binaryIndexName);
}

export function binaryIndexRemove<T extends object>(
  c: Collection<T>,
  dataPosition: number | number[],
  binaryIndexName: string,
  removedFromIndexOnly?: boolean,
) {
  const bi = c.binaryIndices[binaryIndexName];
  let len: number;
  let idx: number;
  let rmidx: number;
  let rmlen: number;
  const rxo: Record<string, boolean> = {};
  let curr: number;
  let shift: number;
  let idxPos: number | null;

  if (Array.isArray(dataPosition)) {
    // when called from chained remove, and only one document in array,
    // it will be faster to use old algorithm
    rmlen = dataPosition.length;
    if (rmlen === 1) {
      dataPosition = dataPosition[0];
    }
    // we were passed an array (batch) of documents so use this 'batch optimized' algorithm
    else {
      for (rmidx = 0; rmidx < rmlen; rmidx++) {
        rxo[dataPosition[rmidx]] = true;
      }

      // remove document from index (with filter function)
      bi.values = bi.values.filter((di) => {
        return !rxo[di];
      });

      // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
      // in which case data positions stay the same.
      if (removedFromIndexOnly === true) {
        return;
      }

      const sortedPositions = dataPosition.slice();
      sortedPositions.sort((a, b) => {
        return a - b;
      });

      // to remove holes, we need to 'shift down' the index's data array positions
      // we need to adjust array positions -1 for each index data positions greater than removed positions
      len = bi.values.length;
      for (idx = 0; idx < len; idx++) {
        curr = bi.values[idx];
        shift = 0;
        for (rmidx = 0; rmidx < rmlen && curr > sortedPositions[rmidx]; rmidx++) {
          shift++;
        }
        bi.values[idx] -= shift;
      }

      // batch processed, bail out
      return;
    }

    // not a batch so continue...
  }

  idxPos = c.getBinaryIndexPosition(dataPosition as number, binaryIndexName);

  if (idxPos === null) {
    // throw new Error('unable to determine binary index position');
    return null;
  }

  // remove document from index (with splice)
  bi.values.splice(idxPos, 1);

  // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
  // in which case data positions stay the same.
  if (removedFromIndexOnly === true) {
    return;
  }

  // since index stores data array positions, if we remove a document
  // we need to adjust array positions -1 for all document positions greater than removed position
  len = bi.values.length;
  for (idx = 0; idx < len; idx++) {
    if (bi.values[idx] > (dataPosition as number)) {
      bi.values[idx]--;
    }
  }
}

export function rangeStart<T extends object>(
  c: Collection<T>,
  prop: string,
  val: any,
  adaptive?: boolean,
  usingDotNotation?: boolean,
) {
  const rcd = c.data;
  const index = c.binaryIndices[prop].values;
  let min = 0;
  let max = index.length - 1;
  let mid = 0;

  if (index.length === 0) {
    return -1;
  }

  // hone in on start position of value
  while (min < max) {
    mid = (min + max) >> 1;

    if (Comparators.lt(Utils.getIn(rcd[index[mid]], prop, usingDotNotation), val, false)) {
      min = mid + 1;
    } else {
      max = mid;
    }
  }

  const lbound = min;

  // found it... return it
  if (Comparators.aeq(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation))) {
    return lbound;
  }

  // if not in index and our value is less than the found one
  if (Comparators.lt(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), false)) {
    return adaptive ? lbound : lbound - 1;
  }

  // not in index and our value is greater than the found one
  return adaptive ? lbound + 1 : lbound;
}

export function rangeEnd<T extends object>(
  c: Collection<T>,
  prop: string,
  val: any,
  usingDotNotation?: boolean,
) {
  const rcd = c.data;
  const index = c.binaryIndices[prop].values;
  let min = 0;
  let max = index.length - 1;
  let mid = 0;

  if (index.length === 0) {
    return -1;
  }

  // hone in on start position of value
  while (min < max) {
    mid = (min + max) >> 1;

    if (Comparators.lt(val, Utils.getIn(rcd[index[mid]], prop, usingDotNotation), false)) {
      max = mid;
    } else {
      min = mid + 1;
    }
  }

  const ubound = max;

  // only eq if last element in array is our val
  if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation))) {
    return ubound;
  }

  // if not in index and our value is less than the found one
  if (Comparators.gt(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), false)) {
    return ubound + 1;
  }

  // either hole or first nonmatch
  if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound - 1]], prop, usingDotNotation))) {
    return ubound - 1;
  }

  // hole, so ubound if nearest gt than the val we were looking for
  return ubound;
}

export function calculateBinaryRange<T extends object>(
  c: Collection<T>,
  op: string,
  prop: string,
  val: any,
): number[] {
  const rcd = c.data;
  const index = c.binaryIndices[prop].values;
  const min = 0;
  const max = index.length - 1;
  let lbound: number;
  let lval: any;
  let ubound: number;

  // when no documents are in collection, return empty range condition
  if (rcd.length === 0) {
    return [0, -1];
  }

  const usingDotNotation = prop.indexOf('.') !== -1;

  const minVal = Utils.getIn(rcd[index[min]], prop, usingDotNotation);
  const maxVal = Utils.getIn(rcd[index[max]], prop, usingDotNotation);

  // if value falls outside of our range return [0, -1] to designate no results
  switch (op) {
    case '$eq':
    case '$aeq':
      if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
        return [0, -1];
      }
      break;
    case '$dteq':
      if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
        return [0, -1];
      }
      break;
    case '$gt':
      // none are within range
      if (Comparators.gt(val, maxVal, true)) {
        return [0, -1];
      }
      // all are within range
      if (Comparators.gt(minVal, val, false)) {
        return [min, max];
      }
      break;
    case '$gte':
      // none are within range
      if (Comparators.gt(val, maxVal, false)) {
        return [0, -1];
      }
      // all are within range
      if (Comparators.gt(minVal, val, true)) {
        return [min, max];
      }
      break;
    case '$lt':
      // none are within range
      if (Comparators.lt(val, minVal, true)) {
        return [0, -1];
      }
      // all are within range
      if (Comparators.lt(maxVal, val, false)) {
        return [min, max];
      }
      break;
    case '$lte':
      // none are within range
      if (Comparators.lt(val, minVal, false)) {
        return [0, -1];
      }
      // all are within range
      if (Comparators.lt(maxVal, val, true)) {
        return [min, max];
      }
      break;
    case '$between':
      // none are within range (low range is greater)
      if (Comparators.gt(val[0], maxVal, false)) {
        return [0, -1];
      }
      // none are within range (high range lower)
      if (Comparators.lt(val[1], minVal, false)) {
        return [0, -1];
      }

      lbound = c.calculateRangeStart(prop, val[0], false, usingDotNotation);
      ubound = c.calculateRangeEnd(prop, val[1], usingDotNotation);

      if (lbound < 0) lbound++;
      if (ubound > max) ubound--;

      if (!Comparators.gt(Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), val[0], true))
        lbound++;
      if (!Comparators.lt(Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), val[1], true))
        ubound--;

      if (ubound < lbound) return [0, -1];

      return [lbound, ubound];
    case '$in': {
      const idxset: (boolean | undefined)[] = [];
      const segResult: number[] = [];
      // query each value '$eq' operator and merge the seqment results.
      for (let j = 0, len = val.length; j < len; j++) {
        const seg = c.calculateRange('$eq', prop, val[j]);

        for (let i = seg[0]; i <= seg[1]; i++) {
          if (idxset[i] === undefined) {
            idxset[i] = true;
            segResult.push(i);
          }
        }
      }
      return segResult;
    }
  }

  // determine lbound where needed
  switch (op) {
    case '$eq':
    case '$aeq':
    case '$dteq':
    case '$gte':
    case '$lt':
      lbound = c.calculateRangeStart(prop, val, false, usingDotNotation);
      lval = Utils.getIn(rcd[index[lbound]], prop, usingDotNotation);
      break;
    default:
      break;
  }

  // determine ubound where needed
  switch (op) {
    case '$eq':
    case '$aeq':
    case '$dteq':
    case '$lte':
    case '$gt':
      ubound = c.calculateRangeEnd(prop, val, usingDotNotation);
      break;
    default:
      break;
  }

  switch (op) {
    case '$eq':
    case '$aeq':
    case '$dteq':
      // if hole (not found)
      if (!Comparators.aeq(lval, val)) {
        return [0, -1];
      }

      return [lbound!, ubound!];

    case '$gt':
      // if hole (not found) ub position is already greater
      if (!Comparators.aeq(Utils.getIn(rcd[index[ubound!]], prop, usingDotNotation), val)) {
        return [ubound!, max];
      }
      // otherwise (found) so ubound is still equal, get next
      return [ubound! + 1, max];

    case '$gte':
      // if hole (not found) lb position marks left outside of range
      if (!Comparators.aeq(Utils.getIn(rcd[index[lbound!]], prop, usingDotNotation), val)) {
        return [lbound! + 1, max];
      }
      // otherwise (found) so lb is first position where its equal
      return [lbound!, max];

    case '$lt':
      // if hole (not found) position already is less than
      if (!Comparators.aeq(Utils.getIn(rcd[index[lbound!]], prop, usingDotNotation), val)) {
        return [min, lbound!];
      }
      // otherwise (found) so lb marks left inside of eq range, get previous
      return [min, lbound! - 1];

    case '$lte':
      // if hole (not found) ub position marks right outside so get previous
      if (!Comparators.aeq(Utils.getIn(rcd[index[ubound!]], prop, usingDotNotation), val)) {
        return [min, ubound! - 1];
      }
      // otherwise (found) so ub is last position where its still equal
      return [min, ubound!];

    default:
      return [0, rcd.length - 1];
  }
}
