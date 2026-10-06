/**
 * User settings.
 *
 * Secrets never live here — the token has its own encrypted store. These are
 * plain preferences, safe to sync across the user's devices.
 */

import { DOT_COM } from './githubHost';

export type Layout = 'side-by-side' | 'unified';

export interface EnterpriseHost {
  host: string;
  /** Device-flow client id registered on that instance, if any. */
  clientId: string;
}

export interface Settings {
  /** Show the "Visualize diff" button on markdown files. */
  showButton: boolean;
  layout: Layout;
  showComments: boolean;
  /** Files larger than this render only on explicit confirmation. */
  maxFileSizeKb: number;
  enterpriseHosts: EnterpriseHost[];
}

export const DEFAULT_SETTINGS: Settings = {
  showButton: true,
  layout: 'side-by-side',
  showComments: true,
  maxFileSizeKb: 500,
  enterpriseHosts: [],
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'sync' || !(KEY in changes)) return;
    listener({ ...DEFAULT_SETTINGS, ...(changes[KEY]!.newValue as Partial<Settings>) });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** Every host the extension is configured to work with. */
export function knownHosts(settings: Settings): string[] {
  return [DOT_COM, ...settings.enterpriseHosts.map((h) => h.host)];
}
