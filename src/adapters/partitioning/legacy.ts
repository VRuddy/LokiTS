import type { Loki } from '../../core/Loki';
import { callAdapter } from '../../persistence/adapter-bridge';
import { buildContainer, isLineStream, missingFile } from './format';

export type LegacyFormat = 'partitioning' | 'lines';

export interface LegacyOptions {
  format: LegacyFormat;
  paging: boolean;
  pageSize: number;
  delimiter: string;
}

const partitionKey = (dbname: string, index: number) => `${dbname}.${index}`;
const pageKey = (dbname: string, index: number, page: number) => `${dbname}.${index}.${page}`;

async function* documentLines(dbref: Loki, index: number): AsyncIterable<string> {
  for (const doc of dbref.collections[index].data) {
    yield JSON.stringify(doc);
  }
}

/**
 * Fills the collections of `dbref` (loaded from a container without manifest) from historical
 * partitions, and returns the keys of the database, as {@link legacyKeys} would.
 */
export async function loadLegacyCollections(
  inner: object,
  dbname: string,
  dbref: Loki,
  options: LegacyOptions,
): Promise<string[]> {
  const keys: string[] = [];
  for (let index = 0; index < dbref.collections.length; index++) {
    const collection = dbref.collections[index];
    if (options.format === 'lines') {
      collection.data = await readLines(inner, partitionKey(dbname, index));
    } else if (options.paging) {
      const pages: string[] = [];
      collection.data = await readPages(inner, dbname, index, options.delimiter, pages);
      // pages left past the last one by a save of a once longer collection
      keys.push(...pages, ...(await probePages(inner, dbname, index, pages.length)));
      continue;
    } else {
      const result = await callAdapter(
        inner,
        'loadDatabase',
        [partitionKey(dbname, index)],
        'load',
      );
      if (result === null || result === undefined) {
        throw missingFile(partitionKey(dbname, index));
      }
      collection.data = dbref.deserializeCollection(result as string, {
        delimited: true,
        collectionIndex: index,
      });
    }
    keys.push(partitionKey(dbname, index));
  }
  return keys;
}

async function readLines(inner: object, key: string): Promise<any[]> {
  const docs: any[] = [];
  if (isLineStream(inner)) {
    const lines = await inner.readLines(key);
    if (lines === null) {
      throw missingFile(key);
    }
    for await (const batch of lines) {
      for (const line of batch) {
        if (line !== '') {
          docs.push(JSON.parse(line));
        }
      }
    }
    return docs;
  }
  const text = await callAdapter(inner, 'loadDatabase', [key], 'load');
  if (text === null || text === undefined) {
    throw missingFile(key);
  }
  for (const line of (text as string).split('\n')) {
    if (line !== '') {
      docs.push(JSON.parse(line));
    }
  }
  return docs;
}

async function readPages(
  inner: object,
  dbname: string,
  index: number,
  delimiter: string,
  keys: string[],
): Promise<any[]> {
  const docs: any[] = [];
  for (let page = 0; ; page++) {
    const key = pageKey(dbname, index, page);
    const result = await callAdapter(inner, 'loadDatabase', [key], 'load');
    if (result === null || result === undefined) {
      throw missingFile(key);
    }
    keys.push(key);
    const rows = (result as string).split(delimiter);
    // a final empty row marks the last page; an empty collection is a lone delimiter
    const isLastPage = rows[rows.length - 1] === '';
    if (isLastPage) {
      rows.pop();
      if (rows.length === 1 && rows[0] === '') {
        rows.pop();
      }
    }
    for (const row of rows) {
      docs.push(JSON.parse(row));
    }
    if (isLastPage) {
      return docs;
    }
  }
}

/**
 * Historical save: container first, then each dirty collection, without generations.
 * `everyCollection` (leaving a manifest) writes every collection, then the container: the
 * manifest stays the committed state until the historical layout is complete.
 */
export async function saveLegacy(
  inner: object,
  dbname: string,
  dbref: Loki,
  options: LegacyOptions,
  everyCollection = false,
): Promise<void> {
  const container = buildContainer(dbref);
  const text = options.format === 'lines' ? `${container}\n` : container;
  if (!everyCollection) {
    await callAdapter(inner, 'saveDatabase', [dbname, text], 'write');
  }

  for (let index = 0; index < dbref.collections.length; index++) {
    if (!everyCollection && !dbref.collections[index].dirty) {
      continue;
    }
    if (options.format === 'lines') {
      await writeLines(inner, partitionKey(dbname, index), dbref, index);
    } else if (options.paging) {
      await savePages(inner, dbname, dbref, index, options);
    } else {
      const result = dbref.serializeDestructured({
        partitioned: true,
        delimited: true,
        partition: index,
      });
      await callAdapter(inner, 'saveDatabase', [partitionKey(dbname, index), result], 'write');
    }
  }

  if (everyCollection) {
    await callAdapter(inner, 'saveDatabase', [dbname, text], 'write');
  }
}

async function writeLines(inner: object, key: string, dbref: Loki, index: number): Promise<void> {
  if (isLineStream(inner)) {
    await inner.writeLines(key, documentLines(dbref, index));
    return;
  }
  const text = dbref.collections[index].data.map((doc) => `${JSON.stringify(doc)}\n`).join('');
  await callAdapter(inner, 'saveDatabase', [key, text], 'write');
}

async function savePages(
  inner: object,
  dbname: string,
  dbref: Loki,
  index: number,
  options: LegacyOptions,
): Promise<void> {
  const data = dbref.collections[index].data;
  const { delimiter, pageSize } = options;
  let docIndex = 0;
  let doneWithPartition = data.length === 0;

  for (let page = 0; ; page++) {
    let pageBuilder = '';
    let pageLen = 0;
    let doneWithPage = false;

    for (;;) {
      if (!doneWithPartition) {
        const serializedObject = JSON.stringify(data[docIndex]);
        pageBuilder += serializedObject;
        pageLen += serializedObject.length;
        if (++docIndex >= data.length) {
          doneWithPartition = true;
        }
      }
      if (pageLen >= pageSize) {
        doneWithPage = true;
      }
      // a delimiter between rows, and a final one after the last row of the partition
      if (!doneWithPage || doneWithPartition) {
        pageBuilder += delimiter;
        pageLen += delimiter.length;
      }
      if (doneWithPartition || doneWithPage) {
        break;
      }
    }

    await callAdapter(inner, 'saveDatabase', [pageKey(dbname, index, page), pageBuilder], 'write');
    if (doneWithPartition) {
      return;
    }
  }
}

/** Keys of a historical database, for deletion and cleanup. Paged collections are probed page by page. */
export async function legacyKeys(
  inner: object,
  dbname: string,
  collectionCount: number,
  options: LegacyOptions,
): Promise<string[]> {
  const keys: string[] = [];
  for (let index = 0; index < collectionCount; index++) {
    if (options.format === 'partitioning' && options.paging) {
      keys.push(...(await probePages(inner, dbname, index, 0)));
    } else {
      keys.push(partitionKey(dbname, index));
    }
  }
  return keys;
}

/** Keys of the consecutive pages that exist from page `from` on. */
async function probePages(
  inner: object,
  dbname: string,
  index: number,
  from: number,
): Promise<string[]> {
  const keys: string[] = [];
  for (let page = from; ; page++) {
    const key = pageKey(dbname, index, page);
    const value = await callAdapter(inner, 'loadDatabase', [key], 'load');
    if (value === null || value === undefined) {
      return keys;
    }
    keys.push(key);
  }
}
