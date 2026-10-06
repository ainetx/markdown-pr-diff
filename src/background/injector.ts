/**
 * Making sure the content script is actually running.
 *
 * The manifest declares it, but Chrome will not inject into tabs that were
 * already open when the extension was loaded or reloaded, and it injects
 * nothing at all when the user has set this extension's site access to
 * "on click". Both produce the same symptom — no button, no explanation — so
 * the worker checks and repairs what it can, and flags what it cannot.
 */

const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/;

function isPullRequestUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return PR_PATH.test(parsed.pathname) ? parsed : null;
  } catch {
    return null;
  }
}

async function badge(text: string, title: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#cf222e' });
    await chrome.action.setTitle({ title });
  } catch {
    // The action API is unavailable in some contexts; nothing depends on it.
  }
}

/**
 * Liveness by round-trip, not by a flag.
 *
 * After the extension is reloaded, the content script left in a tab keeps
 * running but can no longer talk to the extension. It would still be setting
 * any marker it had set before, so only an actual reply proves it is both
 * alive and still connected.
 */
async function isRunning(tabId: number): Promise<boolean> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, { type: 'ping' })) as
      { alive?: boolean } | undefined;
    return reply?.alive === true;
  } catch {
    return false;
  }
}

/**
 * Injects the content script into a pull request tab if it is not there yet.
 * Does nothing — but says so on the toolbar icon — when Chrome has not
 * granted access to the host.
 */
export async function ensureContentScript(tabId: number, url: string | undefined): Promise<void> {
  const parsed = isPullRequestUrl(url);
  if (!parsed) return;

  const origin = `${parsed.origin}/*`;
  const granted = await chrome.permissions.contains({ origins: [origin] });

  if (!granted) {
    await badge(
      '!',
      `Markdown PR Diff cannot run on ${parsed.hostname}.\n` +
        'Open chrome://extensions, press Details, and set Site access to "On all sites".',
    );
    return;
  }

  await badge('', 'Markdown PR Diff');

  if (await isRunning(tabId)) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // The tab navigated away or is otherwise unreachable; the next update
    // event will try again.
  }
}

export function watchTabs(): void {
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'complete' && change.url === undefined) return;
    void ensureContentScript(tabId, tab.url);
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(
      (tab) => void ensureContentScript(tabId, tab.url),
      () => undefined,
    );
  });
}

/** Sweeps tabs that were already open when the extension started. */
export async function repairOpenTabs(): Promise<void> {
  try {
    // No url filter: that form needs the broad "tabs" permission. Plain query
    // returns every tab, and `url` is populated for exactly the hosts this
    // extension may access — which is precisely the set worth repairing.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.url) await ensureContentScript(tab.id, tab.url);
    }
  } catch {
    // Without tab access there is nothing to repair; the per-tab listener
    // still covers everything opened from now on.
  }
}
