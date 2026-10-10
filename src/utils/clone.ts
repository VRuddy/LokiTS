// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
declare const jQuery: any;

export type CloneMethod =
  | 'parse-stringify'
  | 'jquery-extend-deep'
  | 'shallow'
  | 'shallow-assign'
  | 'shallow-recurse-objects';

export function clone(data: any, method?: CloneMethod | string): any {
  if (data === null || data === undefined) {
    return null;
  }

  const cloneMethod = method || 'parse-stringify';
  let cloned: any;

  switch (cloneMethod) {
    case 'parse-stringify':
      cloned = JSON.parse(JSON.stringify(data));
      break;
    case 'jquery-extend-deep':
      cloned = jQuery.extend(true, {}, data);
      break;
    case 'shallow':
      // more compatible method for older browsers
      cloned = Object.create(data.constructor.prototype);
      Object.keys(data).forEach((i) => {
        cloned[i] = data[i];
      });
      break;
    case 'shallow-assign':
      // should be supported by newer environments/browsers
      cloned = Object.create(data.constructor.prototype);
      Object.assign(cloned, data);
      break;
    case 'shallow-recurse-objects': {
      // shallow clone top level properties
      cloned = clone(data, 'shallow');
      const keys = Object.keys(data);
      // for each of the top level properties which are object literals, recursively shallow copy
      keys.forEach((key) => {
        if (typeof data[key] === 'object' && data[key].constructor.name === 'Object') {
          cloned[key] = clone(data[key], 'shallow-recurse-objects');
        } else if (Array.isArray(data[key])) {
          cloned[key] = cloneObjectArray(data[key], 'shallow-recurse-objects');
        }
      });
      break;
    }
    default:
      break;
  }

  return cloned;
}

export function cloneObjectArray(objarray: any[], method?: CloneMethod | string): any {
  if (method == 'parse-stringify') {
    return clone(objarray, method);
  }
  const result: any[] = [];
  for (let i = 0, len = objarray.length; i < len; i++) {
    result[i] = clone(objarray[i], method);
  }
  return result;
}
