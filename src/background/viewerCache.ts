/**
 * Who the stored token belongs to, remembered for a few minutes.
 *
 * The popup and the options page both ask for the account state the moment
 * they open, and answering meant a round trip to GitHub every time — on top of
 * waking a service worker that Chrome had already shut down. The result was a
 * window that sat on "Checking…" for most of a second before saying anything.
 *
 * The answer barely changes: a login does not, and scopes change only when the
 * user re-authorizes, which goes through this module anyway. So it is cached
 * in session storage, which dies with the browser session and never reaches
 * disk. The TTL exists only so that a token revoked on github.com stops being
 * reported as live within a few minutes rather than until a restart; every
 * actual API call still fails loudly on its own.
 */

import type { ViewerInfo } from '@shared/github';

const PREFIX = 'viewer:';
const TTL_MS = 5 * 60_000;

interface Entry {
  viewer: ViewerInfo;
  at: number;
}

export async function cachedViewer(host: string): Promise<ViewerInfo | null> {
  try {
    const key = PREFIX + host;
    const stored = await chrome.storage.session.get(key);
    const entry = stored[key] as Entry | undefined;
    if (!entry) return null;
    if (Date.now() - entry.at > TTL_MS) {
      await chrome.storage.session.remove(key);
      return null;
    }
    return entry.viewer;
  } catch {
    // Session storage is a cache; losing it is never worth failing a request.
    return null;
  }
}

export async function cacheViewer(host: string, viewer: ViewerInfo): Promise<void> {
  try {
    await chrome.storage.session.set({
      [PREFIX + host]: { viewer, at: Date.now() } satisfies Entry,
    });
  } catch {
    // As above.
  }
}

export async function forgetViewer(host: string): Promise<void> {
  try {
    await chrome.storage.session.remove(PREFIX + host);
  } catch {
    // As above.
  }
}
