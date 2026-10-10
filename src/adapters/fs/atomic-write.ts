import { nodeModules } from './node';

export interface WritableHandle {
  writeFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriteIo {
  open(path: string, flags: string): Promise<WritableHandle>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: boolean }): Promise<void>;
  platform: string;
  pid: number;
  dirname(path: string): string;
  basename(path: string): string;
  join(...parts: string[]): string;
}

// antivirus and indexers briefly lock files on Windows
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS = [20, 50, 100, 200, 400];
const CHUNK_SIZE = 64 * 1024;

export function defaultAtomicWriteIo(): AtomicWriteIo {
  const { fsp, path, platform, pid } = nodeModules();
  return {
    open: (file, flags) => fsp.open(file, flags),
    rename: (from, to) => fsp.rename(from, to),
    rm: (file, options) => fsp.rm(file, options),
    platform,
    pid,
    dirname: (file) => path.dirname(file),
    basename: (file) => path.basename(file),
    join: (...parts) => path.join(...parts),
  };
}

/**
 * Writes `target` so that it is either fully replaced or left untouched: unique temporary file in the same
 * directory, fsync, rename, then fsync of the directory.
 */
export async function writeFileAtomic(
  target: string,
  data: string | AsyncIterable<string>,
  io: AtomicWriteIo = defaultAtomicWriteIo(),
): Promise<void> {
  const dir = io.dirname(target);
  const suffix = randomSuffix();
  const tmp = io.join(dir, `.${io.basename(target)}.${io.pid}.${suffix}.tmp`);
  let handle: WritableHandle | undefined;
  let created = false;

  try {
    handle = await io.open(tmp, 'wx');
    created = true;
    if (typeof data === 'string') {
      await handle.writeFile(data);
    } else {
      let chunk = '';
      for await (const piece of data) {
        chunk += piece;
        if (chunk.length >= CHUNK_SIZE) {
          await handle.writeFile(chunk);
          chunk = '';
        }
      }
      if (chunk) {
        await handle.writeFile(chunk);
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(io, tmp, target);
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    // a failed exclusive open leaves tmp to whoever owns it
    if (created) {
      await io.rm(tmp, { force: true }).catch(() => {});
    }
    throw err;
  }

  await syncDirectory(io, dir);
}

function randomSuffix(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function renameWithRetry(io: AtomicWriteIo, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await io.rename(from, to);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const retryable =
        io.platform === 'win32' && code !== undefined && RETRYABLE_RENAME_CODES.has(code);
      if (!retryable || attempt >= RENAME_RETRY_DELAYS.length) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS[attempt]));
    }
  }
}

// Makes the rename itself durable. Windows cannot open a directory, and some file systems refuse
// fsync on one: neither is an error, the file is already in place.
async function syncDirectory(io: AtomicWriteIo, dir: string): Promise<void> {
  if (io.platform === 'win32') {
    return;
  }
  try {
    const handle = await io.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // best effort, see above
  }
}
