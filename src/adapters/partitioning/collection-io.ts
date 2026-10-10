import { callAdapter } from '../../persistence/adapter-bridge';
import { missingFile } from './format';

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

/** Writes the documents one per line under `baseName` (then `baseName.1`, `.2`… for extra pages). */
export async function writeCollection(
  inner: object,
  baseName: string,
  docs: object[],
  paging: PagingOptions,
): Promise<string[]> {
  const pages = toPages(docs, paging);
  const files: string[] = [];
  for (let page = 0; page < pages.length; page++) {
    const name = page === 0 ? baseName : `${baseName}.${page}`;
    await callAdapter(inner, 'saveDatabase', [name, pages[page]], 'write');
    files.push(name);
  }
  return files;
}

export async function readCollection(inner: object, files: string[]): Promise<any[]> {
  const docs: any[] = [];
  for (const file of files) {
    const text = await callAdapter(inner, 'loadDatabase', [file], 'load');
    if (text === null || text === undefined) {
      throw missingFile(file);
    }
    for (const line of (text as string).split('\n')) {
      if (line !== '') {
        docs.push(JSON.parse(line));
      }
    }
  }
  return docs;
}
