export interface DrainOptions {
  /** Keep waiting while saves started meanwhile are pending (default: true). */
  recursiveWait?: boolean;
  /** Stop waiting after recursiveWaitLimitDuration (default: false). */
  recursiveWaitLimit?: boolean;
  /** In ms (default: 2000). */
  recursiveWaitLimitDuration?: number;
}

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * At most one save runs at a time; saves requested meanwhile share a single follow-up save.
 * Waiters are settled in a timer after the save, like the original callbacks.
 */
export class SaveQueue {
  private inFlight = false;
  private locks = 0;
  private current: Waiter[] = [];
  private next: Waiter[] | null = null;
  private watchers: (() => void)[] = [];

  constructor(
    private readonly run: () => Promise<void>,
    private readonly isThrottled: () => boolean,
  ) {}

  get busy(): boolean {
    return this.inFlight || this.locks > 0;
  }

  save(): Promise<void> {
    if (!this.isThrottled()) {
      return this.runSafely();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      if (this.busy) {
        if (!this.next) {
          this.next = [];
        }
        this.next.push(waiter);
      } else {
        this.start([waiter]);
      }
    });
  }

  async drain(options: DrainOptions = {}): Promise<boolean> {
    const {
      recursiveWait = true,
      recursiveWaitLimit = false,
      recursiveWaitLimitDuration = 2000,
    } = options;
    const started = Date.now();

    while (this.busy) {
      await new Promise<void>((resolve) => this.watchers.push(resolve));
      // callbacks of the finished save run first: they may start another save
      await nextMacrotask();
      if (!recursiveWait) {
        return true;
      }
      if (this.busy && recursiveWaitLimit && Date.now() - started > recursiveWaitLimitDuration) {
        return false;
      }
    }
    return true;
  }

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    this.locks++;
    const queuedBefore = this.next?.length ?? 0;
    try {
      return await fn();
    } catch (err) {
      this.cancelQueuedSince(queuedBefore, err);
      throw err;
    } finally {
      this.locks--;
      this.notifyWatchers();
      this.startNext();
    }
  }

  // a synchronous throw must become a rejection, or inFlight would stay stuck
  private runSafely(): Promise<void> {
    try {
      return this.run();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // a save requested while the load ran must not overwrite storage with the state of a failed load
  private cancelQueuedSince(count: number, cause: unknown): void {
    if (!this.next) {
      return;
    }
    const cancelled = this.next.splice(count);
    if (this.next.length === 0) {
      this.next = null;
    }
    const error = new Error('save cancelled: the database failed to load', { cause });
    setTimeout(() => {
      for (const waiter of cancelled) {
        waiter.reject(error);
      }
    }, 1);
  }

  private start(waiters: Waiter[]): void {
    this.inFlight = true;
    this.current = waiters;
    this.runSafely().then(
      () => this.finish(false),
      (err) => this.finish(true, err),
    );
  }

  private finish(failed: boolean, error?: unknown): void {
    const waiters = this.current;
    this.current = [];
    this.inFlight = false;
    const watchers = this.takeWatchers();
    setTimeout(() => {
      for (const waiter of waiters) {
        if (failed) {
          waiter.reject(error);
        } else {
          waiter.resolve();
        }
      }
      for (const notify of watchers) {
        notify();
      }
    }, 1);
    this.startNext();
  }

  private startNext(): void {
    if (this.next && !this.inFlight && this.locks === 0) {
      const next = this.next;
      this.next = null;
      this.start(next);
    }
  }

  private notifyWatchers(): void {
    for (const notify of this.takeWatchers()) {
      notify();
    }
  }

  private takeWatchers(): (() => void)[] {
    const watchers = this.watchers;
    this.watchers = [];
    return watchers;
  }
}
