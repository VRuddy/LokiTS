import { withAdapterCallback } from '../persistence/callbacks';
import type { LokiAdapter, LokiKeyListingAdapter, LokiLineStreamAdapter } from '../types/adapter';
import { adapterError, translateDomError } from './errors';
import { joinLines, splitLineBatches } from './lines';
import { checkKey, isTemporaryName, opfsDirectory } from './opfs/storage';

export interface LokiOpfsAdapterOptions {
  /** Folder inside the origin private file system, created when missing; `/` separates levels. */
  directory?: string;
}

interface IterableDirectory {
  keys(): AsyncIterable<string>;
}

const isNotFound = (err: unknown) => (err as { name?: string } | null)?.name === 'NotFoundError';

// WebKit reports a file held by a sync access handle as InvalidStateError
const WRITE_ERROR_CODES = { InvalidStateError: 'EBUSY' } as const;

async function* decodedTexts(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  // a reader loop rather than for await: Safari has no async iteration of ReadableStream
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) {
      yield tail;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Origin private file system adapter: one file per key, replaced atomically on close. Usable alone or
 * under LokiPartitioningAdapter (one file per collection, crash-safe generations).
 */
export class LokiOpfsAdapter implements LokiAdapter, LokiLineStreamAdapter, LokiKeyListingAdapter {
  options!: LokiOpfsAdapterOptions;
  #directory: Promise<FileSystemDirectoryHandle> | null;

  constructor(options: LokiOpfsAdapterOptions = {}) {
    this.options = options;
    this.#directory = null;
  }

  /** Resolves to false without OPFS, without createWritable(), or where the browser refuses OPFS. */
  static async isSupported(): Promise<boolean> {
    const handle = (globalThis as { FileSystemFileHandle?: { prototype: object } })
      .FileSystemFileHandle;
    const proto = handle?.prototype as { createWritable?: unknown } | undefined;
    if (typeof proto?.createWritable !== 'function') {
      return false;
    }
    try {
      await opfsDirectory();
      return true;
    } catch {
      return false;
    }
  }

  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<string | null> {
    return withAdapterCallback(this.#read(dbname), callback, 'load') as Promise<string | null>;
  }

  saveDatabase(dbname: string, dbstring: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(
      this.#write(dbname, (writable) => writable.write(dbstring)),
      callback,
      'write',
    ) as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.#remove(dbname), callback, 'write') as Promise<void>;
  }

  async readLines(name: string): Promise<AsyncIterable<string[]> | null> {
    const file = await this.#file(name);
    return file ? splitLineBatches(decodedTexts(file.stream())) : null;
  }

  writeLines(name: string, lines: AsyncIterable<string>): Promise<void> {
    return this.#write(name, async (writable) => {
      for await (const chunk of joinLines(lines)) {
        await writable.write(chunk);
      }
    });
  }

  async listKeys(prefix: string): Promise<string[]> {
    const dir = await this.#dir();
    const keys: string[] = [];
    for await (const name of (dir as unknown as IterableDirectory).keys()) {
      if (name.startsWith(prefix) && !isTemporaryName(name)) {
        keys.push(name);
      }
    }
    return keys.sort();
  }

  #dir(): Promise<FileSystemDirectoryHandle> {
    if (!this.#directory) {
      const pending = opfsDirectory(this.options.directory);
      this.#directory = pending;
      // a failure is not cached: OPFS may become available (permission, storage) later
      pending.catch(() => {
        if (this.#directory === pending) {
          this.#directory = null;
        }
      });
    }
    return this.#directory;
  }

  async #file(name: string): Promise<File | null> {
    checkKey(name);
    const dir = await this.#dir();
    try {
      const handle = await dir.getFileHandle(name);
      return await handle.getFile();
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw translateDomError(err, `reading OPFS file ${name}`);
    }
  }

  async #read(name: string): Promise<string | null> {
    const file = await this.#file(name);
    if (!file) {
      return null;
    }
    const text = await file.text();
    // getFileHandle(create) makes an empty file before the atomic close: an interrupted first save leaves it
    return text === '' ? null : text;
  }

  async #write(
    name: string,
    fill: (writable: FileSystemWritableFileStream) => Promise<void>,
  ): Promise<void> {
    checkKey(name);
    const dir = await this.#dir();
    let created = false;
    let writable: FileSystemWritableFileStream | undefined;
    try {
      let handle: FileSystemFileHandle;
      try {
        handle = await dir.getFileHandle(name);
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
        handle = await dir.getFileHandle(name, { create: true });
        created = true;
      }
      if (typeof handle.createWritable !== 'function') {
        throw adapterError(
          'ENOTSUP',
          'OPFS writes need FileSystemFileHandle.createWritable(), missing in this browser',
        );
      }
      writable = await handle.createWritable();
      await fill(writable);
      const done = writable;
      writable = undefined;
      await done.close();
    } catch (err) {
      await writable?.abort().catch(() => {});
      if (created) {
        await dir.removeEntry(name).catch(() => {});
      }
      throw translateDomError(err, `writing OPFS file ${name}`, WRITE_ERROR_CODES);
    }
  }

  async #remove(name: string): Promise<void> {
    checkKey(name);
    const dir = await this.#dir();
    try {
      await dir.removeEntry(name);
    } catch (err) {
      if (!isNotFound(err)) {
        throw translateDomError(err, `deleting OPFS file ${name}`);
      }
    }
  }
}
