import { vi } from 'vitest';

type Bytes = Uint8Array<ArrayBuffer>;

const domError = (name: string, message: string) => new DOMException(message, name);

class FakeFile {
  data: Bytes = new Uint8Array();
}

class FakeWritable {
  #chunks: Bytes[] = [];
  #closed = false;

  constructor(
    private readonly file: FakeFile,
    private readonly onEnd: () => void,
    private readonly failure: () => string | undefined,
  ) {}

  async write(data: string | Uint8Array): Promise<void> {
    const failure = this.failure();
    if (failure) {
      throw domError(failure, 'write failed');
    }
    this.#chunks.push(
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
    );
  }

  async close(): Promise<void> {
    if (this.#closed) {
      throw new TypeError('already closed');
    }
    this.#closed = true;
    const size = this.#chunks.reduce((total, chunk) => total + chunk.length, 0);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.#chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    // the file only changes on close, like the real swap file
    this.file.data = data;
    this.onEnd();
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.onEnd();
  }
}

export class FakeFileHandle {
  readonly kind = 'file';

  constructor(
    readonly name: string,
    readonly file: FakeFile,
    private readonly dir: FakeDirectoryHandle,
  ) {}

  async getFile(): Promise<File> {
    return new File([this.file.data], this.name);
  }

  async createWritable(): Promise<FakeWritable> {
    if (this.dir.locked.has(this.name)) {
      throw domError('NoModificationAllowedError', 'file is locked');
    }
    const swap = `${this.name}.crswap`;
    this.dir.entries.set(swap, new FakeFile());
    return new FakeWritable(
      this.file,
      () => this.dir.entries.delete(swap),
      () => this.dir.takeFailure(this.name),
    );
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly entries = new Map<string, FakeFile | FakeDirectoryHandle>();
  readonly locked = new Set<string>();
  readonly failures = new Map<string, string>();

  constructor(readonly name: string) {}

  takeFailure(name: string): string | undefined {
    const failure = this.failures.get(name);
    this.failures.delete(name);
    return failure;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeDirectoryHandle) {
      return entry;
    }
    if (entry) {
      throw domError('TypeMismatchError', `${name} is a file`);
    }
    if (!options?.create) {
      throw domError('NotFoundError', `${name} not found`);
    }
    const dir = new FakeDirectoryHandle(name);
    this.entries.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    if (name === '' || name.includes('/') || name === '.' || name === '..') {
      throw new TypeError(`invalid name ${name}`);
    }
    let entry = this.entries.get(name);
    if (entry instanceof FakeDirectoryHandle) {
      throw domError('TypeMismatchError', `${name} is a directory`);
    }
    if (!entry) {
      if (!options?.create) {
        throw domError('NotFoundError', `${name} not found`);
      }
      entry = new FakeFile();
      this.entries.set(name, entry);
    }
    return new FakeFileHandle(name, entry, this);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) {
      throw domError('NotFoundError', `${name} not found`);
    }
  }

  async *keys(): AsyncGenerator<string> {
    yield* [...this.entries.keys()];
  }
}

export interface FakeOpfs {
  root: FakeDirectoryHandle;
  /** Text of a file, `undefined` when missing; `path` uses `/` between directories. */
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  names(dir?: string): string[];
  failNextWrite(name: string, errorName: string, dir?: string): void;
  lock(name: string, dir?: string): void;
}

export function installFakeOpfs(): FakeOpfs {
  const root = new FakeDirectoryHandle('');
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  vi.stubGlobal('FileSystemFileHandle', FakeFileHandle);

  const dirOf = (path = ''): FakeDirectoryHandle => {
    let dir = root;
    for (const part of path.split('/').filter(Boolean)) {
      const entry = dir.entries.get(part);
      if (!(entry instanceof FakeDirectoryHandle)) {
        throw new Error(`no directory ${path}`);
      }
      dir = entry;
    }
    return dir;
  };
  const split = (path: string): [string, string] => {
    const index = path.lastIndexOf('/');
    return index < 0 ? ['', path] : [path.slice(0, index), path.slice(index + 1)];
  };

  return {
    root,
    read(path) {
      const [dir, name] = split(path);
      const entry = dirOf(dir).entries.get(name);
      return entry instanceof FakeFile ? new TextDecoder().decode(entry.data) : undefined;
    },
    write(path, text) {
      const [dir, name] = split(path);
      const file = new FakeFile();
      file.data = new TextEncoder().encode(text);
      dirOf(dir).entries.set(name, file);
    },
    names(dir) {
      return [...dirOf(dir).entries.keys()].sort();
    },
    failNextWrite(name, errorName, dir) {
      dirOf(dir).failures.set(name, errorName);
    },
    lock(name, dir) {
      dirOf(dir).locked.add(name);
    },
  };
}
