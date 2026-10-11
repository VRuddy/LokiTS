export class FakeStorage implements Storage {
  #items = new Map<string, string>();
  /** Name of the DOMException thrown by the next setItem. */
  failWith?: string;

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWith) {
      const name = this.failWith;
      this.failWith = undefined;
      throw new DOMException('storage failure', name);
    }
    this.#items.set(key, String(value));
  }
}
