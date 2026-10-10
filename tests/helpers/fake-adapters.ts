type Callback = (value?: unknown) => void;

export const flush = (ms = 10) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Callback adapter whose every response is triggered by the test. */
export class ManualAdapter {
  mode?: string;
  saves: { data: unknown; respond: (err?: unknown) => void }[] = [];
  loads: { name: string; respond: (value: unknown) => void }[] = [];
  deletes: { name: string; respond: (value?: unknown) => void }[] = [];
  exports: { db: any; respond: (err?: unknown) => void }[] = [];

  constructor(mode?: string) {
    this.mode = mode;
  }

  loadDatabase(name: string, callback: Callback): void {
    this.loads.push({ name, respond: callback });
  }

  saveDatabase(_name: string, data: unknown, callback: Callback): void {
    this.saves.push({ data, respond: callback });
  }

  exportDatabase(_name: string, db: unknown, callback: Callback): void {
    this.exports.push({ db, respond: callback });
  }

  deleteDatabase(name: string, callback: Callback): void {
    this.deletes.push({ name, respond: callback });
  }
}

/** Incremental-mode callback adapter: calls getLokiCopy at once, then waits for the test. */
export class ManualIncrementalAdapter {
  mode = 'incremental';
  saves: { copy: any; respond: (err?: unknown) => void }[] = [];

  loadDatabase(_name: string, callback: Callback): void {
    callback(null);
  }

  saveDatabase(_name: string, getLokiCopy: () => unknown, callback: Callback): void {
    this.saves.push({ copy: getLokiCopy(), respond: callback });
  }
}

/** Callback adapter that answers after a delay and records the order of operations. */
export class TimedAdapter {
  log: string[] = [];
  store: Record<string, string> = {};

  constructor(private readonly delay = 20) {}

  loadDatabase(name: string, callback: Callback): void {
    this.log.push('load-start');
    setTimeout(() => {
      this.log.push('load-end');
      callback(this.store[name] ?? null);
    }, this.delay);
  }

  saveDatabase(name: string, data: string, callback: Callback): void {
    this.log.push('save-start');
    setTimeout(() => {
      this.store[name] = data;
      this.log.push('save-end');
      callback();
    }, this.delay);
  }
}
