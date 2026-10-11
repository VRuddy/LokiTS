// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import type { FileHandle } from 'node:fs/promises';
import { withAdapterCallback } from '../persistence/callbacks';
import { writeFileAtomic } from './fs/atomic-write';
import { nodeModules } from './fs/node';
import { CHUNK_SIZE, joinLines, splitLineBatches } from './lines';

// Reading whole chunks and splitting them synchronously avoids several promise ticks per line.
async function* closingTexts(handle: FileHandle): AsyncGenerator<string> {
  try {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(CHUNK_SIZE);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) {
        break;
      }
      yield decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    }
    const tail = decoder.decode();
    if (tail) {
      yield tail;
    }
  } finally {
    // runs on early exit or consumer error too, so the descriptor is never left open
    await handle.close();
  }
}

const isMissing = (err: unknown) => (err as { code?: string } | null)?.code === 'ENOENT';

/** Node file adapter: one file per database, replaced atomically on every save. */
export class LokiFsAdapter {
  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<string | null> {
    return withAdapterCallback(this.read(dbname), callback, 'load') as Promise<string | null>;
  }

  saveDatabase(dbname: string, dbstring: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(
      writeFileAtomic(dbname, dbstring),
      callback,
      'write',
    ) as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.remove(dbname), callback, 'write') as Promise<void>;
  }

  async readLines(name: string): Promise<AsyncIterable<string[]> | null> {
    let handle: FileHandle;
    try {
      handle = await nodeModules().fsp.open(name, 'r');
    } catch (err) {
      if (isMissing(err)) {
        return null;
      }
      throw err;
    }
    return splitLineBatches(closingTexts(handle));
  }

  writeLines(name: string, lines: AsyncIterable<string>): Promise<void> {
    return writeFileAtomic(name, joinLines(lines));
  }

  async listKeys(prefix: string): Promise<string[]> {
    const { fsp, path } = nodeModules();
    const base = path.basename(prefix);
    let entries: string[];
    try {
      entries = await fsp.readdir(path.dirname(prefix));
    } catch (err) {
      if (isMissing(err)) {
        return [];
      }
      throw err;
    }
    // a prefix ending with "." has the basename "x." on every platform, so prefix + rest is exact
    return entries
      .filter((entry) => entry.startsWith(base))
      .map((entry) => prefix + entry.slice(base.length));
  }

  private async read(dbname: string): Promise<string | null> {
    try {
      return await nodeModules().fsp.readFile(dbname, 'utf8');
    } catch (err) {
      if (isMissing(err)) {
        return null;
      }
      throw err;
    }
  }

  private async remove(dbname: string): Promise<void> {
    try {
      await nodeModules().fsp.unlink(dbname);
    } catch (err) {
      if (!isMissing(err)) {
        throw err;
      }
    }
  }
}
