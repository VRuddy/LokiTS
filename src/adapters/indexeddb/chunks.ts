export const STORE = 'LokiIncrementalData';
export const CHUNK_SIZE = 100;

export interface StoredChunk {
  key: string;
  value: string;
}

export type ChunkKind =
  | { type: 'loki' }
  | { type: 'metadata'; collection: string }
  | { type: 'data'; collection: string; index: number };

export interface CollectionLike {
  name: string;
  data: { $loki: number }[];
  idIndex: number[] | null;
  dirtyIds: number[];
  dirty: boolean;
  maxId: number;
  ensureId(): void;
  [key: string]: any;
}

export interface ChunkSink {
  put(chunk: StoredChunk): void;
  delete(key: string): void;
}

export interface SaveOptions {
  serializeChunk?: (collectionName: string, chunk: object[]) => unknown;
}

export interface LoadOptions {
  deserializeChunk?: (collectionName: string, chunk: any) => object[];
  lazyCollections?: string[];
}

export interface ParsedChunk {
  kind: ChunkKind;
  value: any;
}

const DATA_KEY = /^(.+)\.chunk\.(\d+)$/;
const METADATA_KEY = /^(.+)\.metadata$/;

// the suffix is matched from the end so that a collection name may contain dots
export function classifyKey(key: string): ChunkKind {
  if (key === 'loki') {
    return { type: 'loki' };
  }
  const data = DATA_KEY.exec(key);
  if (data) {
    return { type: 'data', collection: data[1], index: Number(data[2]) };
  }
  const metadata = METADATA_KEY.exec(key);
  if (metadata) {
    return { type: 'metadata', collection: metadata[1] };
  }
  throw new Error(`Corrupted database - unknown chunk ${key}`);
}

export function randomVersionId(): string {
  // only has to differ from this writer's recent versions, not be globally unique
  return Math.random().toString(36).substring(2);
}

export function getChunk(collection: CollectionLike, chunkId: number): object[] {
  const minId = chunkId * CHUNK_SIZE;
  const maxId = minId + CHUNK_SIZE - 1;

  collection.ensureId();
  const idIndex = collection.idIndex as number[];

  let max = idIndex.length - 1;
  let min = 0;
  while (idIndex[min] < idIndex[max]) {
    const mid = (min + max) >> 1;
    if (idIndex[mid] < minId) {
      min = mid + 1;
    } else {
      max = mid;
    }
  }
  if (!(max === min && idIndex[min] >= minId && idIndex[min] <= maxId)) {
    return [];
  }
  const first = min;

  // $loki ids have holes when documents are removed, so look back from the fullest possible chunk
  let last = -1;
  for (let i = first + CHUNK_SIZE - 1; i >= first; i--) {
    if (idIndex[i] <= maxId) {
      last = i;
      break;
    }
  }

  const firstElement = collection.data[first];
  if (!(firstElement && firstElement.$loki >= minId && firstElement.$loki <= maxId)) {
    throw new Error('broken invariant firstelement');
  }
  const lastElement = collection.data[last];
  if (!(lastElement && lastElement.$loki >= minId && lastElement.$loki <= maxId)) {
    throw new Error('broken invariant lastElement');
  }

  const chunk = collection.data.slice(first, last + 1);
  if (chunk.length > CHUNK_SIZE) {
    throw new Error('broken invariant - chunk size');
  }
  return chunk;
}

const dataKey = (collection: string, index: number) => `${collection}.chunk.${index}`;
const metadataKey = (collection: string) => `${collection}.metadata`;

/**
 * Writes the copy into `sink`, mutating it (it is a throwaway copy). `full` is null on the incremental
 * path; otherwise it lists the stored keys, and those that no longer belong to the database are deleted.
 */
export function writeChunks(
  sink: ChunkSink,
  loki: { collections: CollectionLike[]; [key: string]: any },
  full: { keys: string[] } | null,
  options: SaveOptions,
): string {
  const keep = new Set<string>(['loki']);

  loki.collections.forEach((collection, position) => {
    const putChunk = (chunkId: number) => {
      let chunkData: unknown = getChunk(collection, chunkId);
      if (options.serializeChunk) {
        chunkData = options.serializeChunk(collection.name, chunkData as object[]);
      }
      // stringified now: IndexedDB clones asynchronously and the documents are mutable
      sink.put({ key: dataKey(collection.name, chunkId), value: JSON.stringify(chunkData) });
    };

    const dirtyChunks = new Set<number>();
    if (full === null) {
      for (const id of collection.dirtyIds) {
        dirtyChunks.add((id / CHUNK_SIZE) | 0);
      }
      dirtyChunks.forEach(putChunk);
    } else {
      const maxChunkId = (collection.maxId / CHUNK_SIZE) | 0;
      for (let chunkId = 0; chunkId <= maxChunkId; chunkId++) {
        putChunk(chunkId);
        keep.add(dataKey(collection.name, chunkId));
      }
      keep.add(metadataKey(collection.name));
    }
    collection.dirtyIds = [];

    if (collection.dirty || dirtyChunks.size || full !== null) {
      collection.idIndex = [];
      collection.data = [];
      collection.idbVersionId = randomVersionId();
      sink.put({ key: metadataKey(collection.name), value: JSON.stringify(collection) });
    }
    loki.collections[position] = { name: collection.name } as CollectionLike;
  });

  if (full !== null) {
    for (const key of full.keys) {
      if (!keep.has(key)) {
        sink.delete(key);
      }
    }
  }

  loki.idbVersionId = randomVersionId();
  sink.put({ key: 'loki', value: JSON.stringify(loki) });
  return loki.idbVersionId;
}

export function versionIdOf(record: StoredChunk | undefined): string | null {
  if (!record) {
    return null;
  }
  try {
    return JSON.parse(record.value).idbVersionId || null;
  } catch {
    return null;
  }
}

export function parseChunk(
  chunk: StoredChunk,
  deserializeChunk: LoadOptions['deserializeChunk'],
  lazyCollections: string[],
): ParsedChunk {
  const kind = classifyKey(chunk.key);
  const lazy = kind.type === 'data' && lazyCollections.includes(kind.collection);
  let value: any = lazy ? chunk.value : JSON.parse(chunk.value);
  if (kind.type === 'data' && !lazy && deserializeChunk) {
    value = deserializeChunk(kind.collection, value);
  }
  return { kind, value };
}

export function assembleLoki(chunks: ParsedChunk[], options: LoadOptions): Record<string, any> {
  const lazyCollections = options.lazyCollections ?? [];
  // browsers return keys in string order (0, 1, 10, 100…): sort by chunk index to keep $loki order
  chunks.sort(
    (a, b) =>
      (a.kind.type === 'data' ? a.kind.index : 0) - (b.kind.type === 'data' ? b.kind.index : 0),
  );

  let loki: Record<string, any> | undefined;
  const byCollection = new Map<string, { metadata: any; dataChunks: any[] }>();
  const entry = (name: string) => {
    let found = byCollection.get(name);
    if (!found) {
      found = { metadata: null, dataChunks: [] };
      byCollection.set(name, found);
    }
    return found;
  };
  for (const chunk of chunks) {
    if (chunk.kind.type === 'loki') {
      loki = chunk.value;
    } else if (chunk.kind.type === 'data') {
      entry(chunk.kind.collection).dataChunks.push(chunk.value);
    } else {
      entry(chunk.kind.collection).metadata = chunk.value;
    }
  }
  if (!loki) {
    throw new Error('Corrupted database - missing database metadata');
  }

  loki.collections.forEach((stub: { name: string }, position: number) => {
    const stored = byCollection.get(stub.name);
    if (!stored) {
      return;
    }
    if (!stored.metadata) {
      throw new Error(`Corrupted database - missing metadata chunk for ${stub.name}`);
    }
    const collection = stored.metadata;
    loki!.collections[position] = collection;
    const lazy = lazyCollections.includes(stub.name);
    collection.getData = () => {
      const data: object[] = [];
      stored.dataChunks.forEach((chunk, index) => {
        let docs = chunk;
        if (lazy) {
          docs = JSON.parse(chunk);
          if (options.deserializeChunk) {
            docs = options.deserializeChunk(stub.name, docs);
          }
        }
        for (const doc of docs) {
          data.push(doc);
        }
        stored.dataChunks[index] = null;
      });
      return data;
    };
  });
  return loki;
}
