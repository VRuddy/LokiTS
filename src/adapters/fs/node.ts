import type * as FsPromises from 'node:fs/promises';
import type * as Path from 'node:path';

export interface NodeModules {
  fsp: typeof FsPromises;
  path: typeof Path;
  platform: string;
  pid: number;
}

interface NodeProcess {
  getBuiltinModule?: (id: string) => unknown;
  platform: string;
  pid: number;
}

/** Node built-ins, resolved at run time so the browser bundle never imports them. */
export function nodeModules(): NodeModules {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (!proc || typeof proc.getBuiltinModule !== 'function') {
    throw new Error('this adapter requires Node.js 20.16 or later');
  }
  return {
    fsp: proc.getBuiltinModule('node:fs/promises') as typeof FsPromises,
    path: proc.getBuiltinModule('node:path') as typeof Path,
    platform: proc.platform,
    pid: proc.pid,
  };
}
