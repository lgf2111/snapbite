import '@testing-library/jest-dom/vitest';

// jsdom under Vitest does not reliably expose Web Storage, so provide a small
// in-memory localStorage polyfill for tests that need it.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    #data = new Map<string, string>();
    get length(): number {
      return this.#data.size;
    }
    clear(): void {
      this.#data.clear();
    }
    getItem(key: string): string | null {
      return this.#data.has(key) ? (this.#data.get(key) as string) : null;
    }
    key(index: number): string | null {
      return Array.from(this.#data.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.#data.delete(key);
    }
    setItem(key: string, value: string): void {
      this.#data.set(key, String(value));
    }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}
