import { callAdapter } from '../../persistence/adapter-bridge';
import { fileKey, invalidJson, isLineStream, missingFile } from './format';

export interface PagingOptions {
  enabled: boolean;
  pageSize: number;
}

// JSON.stringify never emits a raw line break, so one document per line is unambiguous
function toPages(docs: object[], paging: PagingOptions): string[] {
  const lines = docs.map((doc) => JSON.stringify(doc));
  if (!paging.enabled) {
    return [lines.join('\n')];
  }
  const pages: string[] = [];
  let page = '';
  for (const line of lines) {
    if (page !== '' && page.length + 1 + line.length > paging.pageSize) {
      pages.push(page);
      page = '';
    }
    page = page === '' ? line : `${page}\n${line}`;
  }
  pages.push(page);
  return pages;
}

async function* documentLines(docs: object[]): AsyncIterable<string> {
  for (const doc of docs) {
    yield JSON.stringify(doc);
  }
}

/**
 * Writes the documents one per line under `baseName` (then `baseName.1`, `.2`… for extra pages),
 * names relative to the database; returns those names. An inner adapter with line streams takes
 * the whole collection in one file, without paging.
 */
export async function writeCollection(
  inner: object,
  dbname: string,
  baseName: string,
  docs: object[],
  paging: PagingOptions,
): Promise<string[]> {
  if (isLineStream(inner)) {
    await inner.writeLines(fileKey(dbname, baseName), documentLines(docs));
    return [baseName];
  }
  const pages = toPages(docs, paging);
  const files: string[] = [];
  for (let page = 0; page < pages.length; page++) {
    const name = page === 0 ? baseName : `${baseName}.${page}`;
    await callAdapter(inner, 'saveDatabase', [fileKey(dbname, name), pages[page]], 'write');
    files.push(name);
  }
  return files;
}

export async function readCollection(
  inner: object,
  dbname: string,
  files: string[],
): Promise<any[]> {
  const docs: any[] = [];
  const streamed = isLineStream(inner);
  for (const file of files) {
    const key = fileKey(dbname, file);
    if (streamed) {
      const lines = await inner.readLines(key);
      if (lines === null) {
        throw missingFile(key);
      }
      for await (const batch of lines) {
        pushLines(docs, batch, key);
      }
      continue;
    }
    const text = await callAdapter(inner, 'loadDatabase', [key], 'load');
    if (text === null || text === undefined) {
      throw missingFile(key);
    }
    pushLines(docs, (text as string).split('\n'), key);
  }
  return docs;
}

/** Parses one document per non-empty line into `docs`. */
export function pushLines(docs: unknown[], lines: string[], key: string): void {
  try {
    for (const line of lines) {
      if (line !== '') {
        docs.push(JSON.parse(line));
      }
    }
  } catch (err) {
    throw invalidJson(key, err);
  }
}
