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

// jsdom ships no object-URL store. The capture flow uses it only to preview a
// picked photo, so a stable fake URL is enough for the DOM assertions.
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => 'blob:test',
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: () => {},
    configurable: true,
    writable: true,
  });
}

// jsdom's Blob predates the promise-returning readers the File API has today.
// The service worker reads a shared File with arrayBuffer(); give the test Blob
// the method browsers already have, backed by jsdom's FileReader.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  const read = <T>(blob: Blob, method: 'readAsArrayBuffer' | 'readAsText') =>
    new Promise<T>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as T);
      reader.onerror = () => reject(reader.error);
      reader[method](blob);
    });
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value: function (this: Blob) {
      return read<ArrayBuffer>(this, 'readAsArrayBuffer');
    },
    configurable: true,
  });
  Object.defineProperty(Blob.prototype, 'text', {
    value: function (this: Blob) {
      return read<string>(this, 'readAsText');
    },
    configurable: true,
  });
}

// jsdom ships no PointerEvent. React and the gesture code only read the event
// type, the pointer id, the primary flag and the coordinates, so a MouseEvent
// carrying them will do.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: MouseEventInit & Partial<PointerEvent> = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventShim,
    configurable: true,
  });
}
