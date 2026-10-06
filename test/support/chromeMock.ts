/** Minimal chrome.* surface so modules that touch storage can run under jsdom. */

interface StoreArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: string }): Promise<void>;
}

function area(): StoreArea & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    _data: data,
    async get(keys) {
      if (keys === undefined || keys === null) return Object.fromEntries(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of list) if (data.has(key)) out[key] = data.get(key);
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      for (const key of list) data.delete(key);
    },
    async setAccessLevel() {
      // no-op
    },
  };
}

export interface ChromeMock {
  storage: {
    local: ReturnType<typeof area>;
    sync: ReturnType<typeof area>;
    session: ReturnType<typeof area>;
    onChanged: { addListener(): void; removeListener(): void };
  };
  runtime: { sendMessage(): Promise<unknown>; getURL(path: string): string };
}

export function installChromeMock(): ChromeMock {
  const mock: ChromeMock = {
    storage: {
      local: area(),
      sync: area(),
      session: area(),
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    runtime: {
      sendMessage: async () => undefined,
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}
