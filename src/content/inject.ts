/**
 * The one thing this extension adds to a GitHub page: a button.
 *
 * No diff is hidden, no node is moved, no React subtree is touched. If the
 * page's markup changes shape and a file block cannot be identified, the
 * button simply does not appear — the pull request keeps working exactly as
 * it did.
 */

import { BUILD_STAMP } from '@shared/config';
import { parseCommitUrl, parsePullRequestUrl } from '@shared/githubHost';
import { send } from '@shared/messages';
import type { ChangedFile, DiffTarget } from '@shared/github';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from '@shared/settings';
import { openOverlay, type OverlayHandle } from '@overlay/shell';
import { describePage, findMarkdownFileBlocks, isDiffPage } from './locate';
import { watchNavigation } from './nav';

const BUTTON_CLASS = 'mdpd-open-button';

/**
 * Starts at the defaults rather than null.
 *
 * Gating the whole feature on a loaded settings object made the button depend
 * on an async call that can simply never resolve, and then nothing appears and
 * nothing explains why. Defaults first, user preference applied when it
 * arrives: the worst case is a button that briefly appears for someone who
 * turned it off, which `enhance` then removes.
 */
let settings: Settings = DEFAULT_SETTINGS;

/** Last failure inside enhance, surfaced through the diagnostics report. */
let lastFailure: string | null = null;
let overlay: OverlayHandle | null = null;

/** Cached per diff so repeated opens do not re-query the API. */
let cache: { key: string; target: DiffTarget; files: ChangedFile[] } | null = null;

/** What this page is a diff of, as a cache key — null when it is not one. */
function contextKey(url: string = location.href): string | null {
  const pr = parsePullRequestUrl(url);
  if (pr) return `${pr.host}/${pr.owner}/${pr.repo}/pull/${pr.number}`;

  const commit = parseCommitUrl(url);
  if (commit) return `${commit.host}/${commit.owner}/${commit.repo}/commit/${commit.sha}`;

  return null;
}

async function diffContext(): Promise<{ target: DiffTarget; files: ChangedFile[] }> {
  const key = contextKey();
  if (!key) throw new Error('This page is neither a pull request nor a commit.');
  if (cache?.key === key) return cache;

  const pr = parsePullRequestUrl(location.href);
  const [target, files] = pr
    ? await Promise.all([
        send({ type: 'pr:info', locator: pr }),
        send({ type: 'pr:files', locator: pr }),
      ])
    : await (async () => {
        // One commit request serves both, so these cannot usefully race: the
        // second call is answered from the first one's cache.
        const commit = parseCommitUrl(location.href)!;
        const info = await send({ type: 'commit:info', locator: commit });
        return [info, await send({ type: 'commit:files', locator: commit })] as const;
      })();

  cache = { key, target, files };
  return cache;
}

function makeButton(path: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.textContent = 'Visualize diff';
  button.title = `Open the rendered markdown diff for ${path}`;
  // GitHub's own styles do not reach this button's internals, and ours do not
  // reach the page: everything else we draw lives in a shadow root.
  button.style.cssText = [
    'font: inherit',
    'font-size: 12px',
    'line-height: 20px',
    'margin-left: 8px',
    'padding: 1px 10px',
    'border-radius: 6px',
    'border: 1px solid var(--borderColor-default, #d1d9e0)',
    'background: var(--bgColor-muted, #f6f8fa)',
    'color: var(--fgColor-default, #1f2328)',
    'cursor: pointer',
  ].join(';');
  return button;
}

function setBusy(button: HTMLButtonElement, busy: boolean, label = 'Visualize diff'): void {
  button.disabled = busy;
  button.textContent = busy ? 'Loading…' : label;
}

async function openFor(path: string, button: HTMLButtonElement): Promise<void> {
  setBusy(button, true);
  try {
    const { target, files } = await diffContext();

    const file =
      files.find((candidate) => candidate.path === path) ??
      files.find((candidate) => candidate.previousPath === path);

    if (!file) {
      throw new Error(`${path} is not among the files this diff changes.`);
    }

    const current = settings;
    const payload = await send({ type: 'pr:file-diff', target, file });

    const sizeKb = (payload.baseText.length + payload.headText.length) / 1024;
    if (sizeKb <= current.maxFileSizeKb || confirmLarge(path, sizeKb, current.maxFileSizeKb)) {
      overlay?.close();
      overlay = openOverlay({ payload, settings: current });
    }
    setBusy(button, false);
  } catch (error) {
    button.title = error instanceof Error ? error.message : String(error);
    setBusy(button, false, 'Failed — retry');
  }
}

function confirmLarge(path: string, sizeKb: number, limitKb: number): boolean {
  return window.confirm(
    `${path} is about ${Math.round(sizeKb)} KB, over the ${limitKb} KB limit set in the extension options. Render it anyway?`,
  );
}

function enhance(): void {
  if (!isDiffPage()) return;
  if (!settings.showButton) {
    for (const stale of document.querySelectorAll(`.${BUTTON_CLASS}`)) stale.remove();
    return;
  }

  let blocks: ReturnType<typeof findMarkdownFileBlocks>;
  try {
    blocks = findMarkdownFileBlocks();
  } catch (error) {
    lastFailure = `scanning the page failed: ${String(error)}`;
    return;
  }

  for (const block of blocks) {
    // The only guard is whether our button is actually present. Checking a
    // marker attribute instead would leave the button gone for good the first
    // time GitHub re-renders a file header out from under it.
    if (block.header.querySelector(`.${BUTTON_CLASS}`)) continue;

    const button = makeButton(block.path);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openFor(block.path, button);
    });

    try {
      // Beside the file name, but outside whatever clips it: a long path is
      // truncated, and a button sharing that container is truncated with it.
      block.insertAfter.insertAdjacentElement('afterend', button);
    } catch (error) {
      lastFailure = `inserting the button failed: ${String(error)}`;
    }
  }
}

/** Answers the popup's "why is there no button here" question. */
chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  // A reply to this is the only trustworthy proof that this instance is alive
  // and still connected to the extension.
  if (message?.type === 'ping') {
    sendResponse({ alive: true });
    return undefined;
  }
  if (message?.type !== 'diagnose') return undefined;
  sendResponse({
    build: BUILD_STAMP,
    ...describePage(),
    buttonsPresent: document.querySelectorAll(`.${BUTTON_CLASS}`).length,
    showButtonSetting: settings.showButton,
    lastFailure,
  });
  return undefined;
});

/**
 * Handle to the running instance, kept in the isolated world.
 *
 * Reloading the extension orphans the content script already in a tab: it
 * keeps running, its observers keep firing, but every chrome.* call is dead.
 * A plain "already running" boolean made that orphan look healthy and blocked
 * the replacement, so instead each injection shuts the previous instance down
 * and takes over.
 */
const INSTANCE = '__mdpdInstance';

interface Instance {
  stop(): void;
}

function main(): Instance {
  loadSettings()
    .then((loaded) => {
      settings = loaded;
      enhance();
    })
    .catch((error: unknown) => {
      // Keep the defaults and keep working; just record why.
      lastFailure = `settings could not be loaded: ${String(error)}`;
    });

  const unsubscribe = onSettingsChanged((next) => {
    settings = next;
    enhance();
  });

  const watcher = watchNavigation(() => {
    // A different pull request or commit invalidates the cached file list.
    if (cache && cache.key !== contextKey()) cache = null;
    enhance();
  });

  return {
    stop() {
      watcher.stop();
      unsubscribe();
      overlay?.close();
      for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) button.remove();
    },
  };
}

declare global {
  interface Window {
    __mdpdInstance?: Instance;
  }
}

// Replace whatever was here before, dead or alive.
try {
  window[INSTANCE]?.stop();
} catch {
  // An orphaned instance can fail on the way out; it is being discarded anyway.
}

/**
 * Sweep away anything a previous instance left in the page.
 *
 * Builds older than this mechanism had no teardown of their own, so their
 * button and their overlay survived a reload and kept serving the page from
 * stale code — the new script would run beside them, invisibly, while every
 * click still went to the old one. Removing the artefacts directly makes the
 * takeover complete whatever the previous build knew how to do.
 */
for (const stale of document.querySelectorAll('.mdpd-open-button, .mdpd-host')) {
  stale.remove();
}

window[INSTANCE] = main();
