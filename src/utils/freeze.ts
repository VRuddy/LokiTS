// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { clone } from './clone';

export function deepFreeze(obj: any): void {
  let prop: string;
  let i: number;
  if (Array.isArray(obj)) {
    for (i = 0; i < obj.length; i++) {
      deepFreeze(obj[i]);
    }
    freeze(obj);
  } else if (obj !== null && typeof obj === 'object') {
    for (prop in obj) {
      if (Object.hasOwn(obj, prop)) {
        deepFreeze(obj[prop]);
      }
    }
    freeze(obj);
  }
}

export function freeze(obj: any): void {
  if (!Object.isFrozen(obj)) {
    Object.freeze(obj);
  }
}

export function unFreeze<T = any>(obj: T): T {
  if (!Object.isFrozen(obj)) {
    return obj;
  }
  return clone(obj, 'shallow');
}
