/**
 * Enough of chrome.storage for the overlay's draft handling to work outside
 * the extension. The playground never talks to GitHub, so nothing else of the
 * extension API surface is needed.
 */

const memory = new Map<string, unknown>();

const area = {
  async get(keys?: string | string[] | null) {
    if (keys === undefined || keys === null) return Object.fromEntries(memory);
    const list = typeof keys === 'string' ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const key of list) if (memory.has(key)) out[key] = memory.get(key);
    return out;
  },
  async set(items: Record<string, unknown>) {
    for (const [key, value] of Object.entries(items)) memory.set(key, value);
  },
  async remove(keys: string | string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) memory.delete(key);
  },
};

export function installChromeShim(): void {
  if (
    'chrome' in globalThis &&
    (globalThis as { chrome?: { storage?: unknown } }).chrome?.storage
  ) {
    return;
  }
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: { local: area, sync: area, session: area, onChanged: { addListener() {} } },
      runtime: { sendMessage: async () => undefined },
    },
  });
}
