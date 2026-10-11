// Ported from LokiJS (incremental-indexeddb-adapter.js), MIT. Original author: radex (Radek Pietruszewski).
import { invoke } from '../../persistence/callbacks';
import { adapterError, translateDomError } from '../errors';
import { type ParsedChunk, STORE, type StoredChunk } from './chunks';

export function indexedDBFactory(): IDBFactory {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    throw adapterError('ENOTSUP', 'IndexedDB is not available in this environment');
  }
  return factory;
}

export function onRequest<T>(
  request: IDBRequest<T>,
  onSuccess: (result: T) => void,
  onError: (err: unknown) => void,
): void {
  request.onsuccess = () => {
    try {
      onSuccess(request.result);
    } catch (err) {
      onError(err);
    }
  };
  request.onerror = () => onError(request.error);
}

export function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let blocked = false;
    try {
      request = factory.open(name, 1);
    } catch (err) {
      reject(translateDomError(err, `opening IndexedDB ${name}`));
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      } else {
        request.transaction?.abort();
        reject(new Error(`Invalid old version ${event.oldVersion} for IndexedDB upgrade`));
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        // the caller already got EBUSY: do not leak a connection that nobody will close
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        reject(new Error(`Missing ${STORE} in IndexedDB ${name}`));
        return;
      }
      resolve(db);
    };
    request.onblocked = () => {
      blocked = true;
      reject(adapterError('EBUSY', `opening IndexedDB ${name} is blocked by another connection`));
    };
    request.onerror = () => reject(translateDomError(request.error, `opening IndexedDB ${name}`));
  });
}

function createKeyRanges(keys: IDBValidKey[], count: number): IDBKeyRange[] {
  const perRange = Math.floor(keys.length / count);
  const ranges: IDBKeyRange[] = [];
  for (let i = 0; i < count; i++) {
    const minKey = keys[perRange * i];
    const maxKey = keys[perRange * (i + 1)];
    if (i === 0) {
      ranges.push(IDBKeyRange.upperBound(maxKey, true));
    } else if (i === count - 1) {
      ranges.push(IDBKeyRange.lowerBound(minKey));
    } else {
      ranges.push(IDBKeyRange.bound(minKey, maxKey, false, true));
    }
  }
  return ranges;
}

/**
 * Reads every chunk in one readonly transaction. Above 100 keys, reads in key ranges, half of them at
 * a time, so the main thread parses while IndexedDB fetches.
 */
export function readAllChunks(
  tx: IDBTransaction,
  megachunkCount: number,
  parse: (chunk: StoredChunk) => ParsedChunk,
  onFetchStart?: () => void,
): Promise<ParsedChunk[]> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(STORE);
    const fail = (err: unknown) => reject(translateDomError(err, 'reading IndexedDB'));
    const parsed: ParsedChunk[] = [];
    const parseAll = (chunks: StoredChunk[]) => {
      chunks.forEach((chunk, index) => {
        parsed.push(parse(chunk));
        (chunks as unknown[])[index] = null;
      });
    };

    onRequest(
      store.getAllKeys(),
      (keys) => {
        keys.sort();
        if (keys.length <= 100) {
          onRequest(
            store.getAll(),
            (chunks) => {
              parseAll(chunks as StoredChunk[]);
              resolve(parsed);
            },
            fail,
          );
          return;
        }
        const ranges = createKeyRanges(keys, megachunkCount);
        const perWave = megachunkCount / 2;
        let received = 0;
        const request = (index: number, wave: number) => {
          onRequest(
            store.getAll(ranges[index]),
            (chunks) => {
              if (wave < 2) {
                request(index + perWave, wave + 1);
              }
              parseAll(chunks as StoredChunk[]);
              received++;
              if (received === megachunkCount) {
                resolve(parsed);
              }
            },
            fail,
          );
        };
        for (let i = 0; i < perWave; i++) {
          request(i, 1);
        }
      },
      fail,
    );
    if (onFetchStart) {
      invoke(onFetchStart);
    }
  });
}
