import { adapterError } from '../errors';

// Files a browser shows next to the target while a writable is open (observed with a probe in each engine).
export const TEMPORARY_SUFFIXES = ['.crswap'];

export const isTemporaryName = (name: string) =>
  TEMPORARY_SUFFIXES.some((suffix) => name.endsWith(suffix));

export function checkKey(key: string): void {
  if (key === '' || key === '.' || key === '..' || key.includes('/') || key.includes('\\')) {
    throw adapterError(
      'EINVAL',
      `invalid OPFS file name ${JSON.stringify(key)}: use the directory option for folders`,
    );
  }
}

interface StorageManagerLike {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
}

export async function opfsDirectory(path?: string): Promise<FileSystemDirectoryHandle> {
  const storage = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator
    ?.storage;
  if (typeof storage?.getDirectory !== 'function') {
    throw adapterError(
      'ENOTSUP',
      'OPFS is not available: navigator.storage.getDirectory() is missing (it needs a secure context and a recent browser)',
    );
  }
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await storage.getDirectory();
  } catch (err) {
    // Firefox refuses OPFS in private browsing
    throw adapterError('ENOTSUP', `OPFS is not available: ${(err as Error)?.message ?? err}`, err);
  }
  for (const part of (path ?? '').split('/').filter(Boolean)) {
    checkKey(part);
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}
