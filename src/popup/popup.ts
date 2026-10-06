/** Toolbar popup: connection state at a glance plus the two toggles people flip most. */

import { DOT_COM } from '@shared/githubHost';
import { BUILD_STAMP } from '@shared/config';
import { send } from '@shared/messages';
import { loadSettings, saveSettings, type Settings } from '@shared/settings';

const statusEl = document.querySelector<HTMLElement>('#status')!;
const showButton = document.querySelector<HTMLInputElement>('#showButton')!;
const showComments = document.querySelector<HTMLInputElement>('#showComments')!;

document.querySelector('#open-options')!.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

/**
 * Reports what the page-scanning selectors found. GitHub's diff markup is the
 * one thing this extension cannot control, so when the button fails to appear
 * the answer should be one click away rather than a debugging session.
 */
document.querySelector('#diagnose')!.addEventListener('click', async () => {
  const out = document.querySelector<HTMLElement>('#diag')!;
  out.hidden = false;
  out.textContent = 'Scanning…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    out.textContent = 'No active tab.';
    return;
  }

  try {
    const { report, autoRunning } = await askPage(tab.id);
    const environment = await describeEnvironment(tab.url);
    const full = { autoRunning, environment, ...report };
    out.textContent = summarize(full as DiagnosisReport, autoRunning, environment);
    addCopyButton(out, JSON.stringify(full, null, 2));
  } catch (error) {
    out.textContent =
      error instanceof Error && error.message
        ? error.message
        : 'Could not inspect this page. Open a pull request and try again.';
  }
});

/**
 * Asks the page's content script what it found.
 *
 * A tab opened before the extension was last reloaded is still running the
 * previous content script, or none at all — Chrome does not re-inject into
 * existing tabs. Rather than telling the user to go and reload things, inject
 * the current script and ask again.
 */
async function askPage(tabId: number): Promise<{ report: DiagnosisReport; autoRunning: boolean }> {
  const ask = () =>
    chrome.tabs.sendMessage(tabId, { type: 'diagnose' }) as Promise<DiagnosisReport | undefined>;

  // Whether the script answers before being injected is the whole question:
  // if it does, the extension is running on the page by itself.
  try {
    const first = await ask();
    if (first) return { report: first, autoRunning: true };
  } catch {
    // No receiver; fall through to injecting one.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    throw new Error(
      'This page is not a GitHub pull request the extension can act on, or permission for this host has not been granted.',
    );
  }

  const second = await ask();
  if (!second) throw new Error('The content script loaded but did not answer.');
  return { report: second, autoRunning: false };
}

interface Environment {
  host: string;
  grantedOrigins: string[];
  hostGranted: boolean;
  manifestMatches: string[];
}

/** What Chrome actually lets the extension do here, as opposed to what it asked for. */
async function describeEnvironment(url: string | undefined): Promise<Environment> {
  const host = url ? new URL(url).hostname : '';
  const granted = await chrome.permissions.getAll();
  const manifest = chrome.runtime.getManifest();
  return {
    host,
    grantedOrigins: granted.origins ?? [],
    hostGranted: host
      ? await chrome.permissions.contains({ origins: [`https://${host}/*`] })
      : false,
    manifestMatches: (manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []),
  };
}

interface DiagnosisReport {
  url: string;
  isFilesPage: boolean;
  candidates: { path: string; carrier: string; headerTag: string }[];
  blocks: { path: string; headerOuterHtml: string }[];
}

function summarize(
  report: DiagnosisReport,
  autoRunning: boolean,
  environment: Environment,
): string {
  const lines: string[] = [];

  if (!autoRunning) {
    lines.push(
      'The extension was NOT running on this page by itself — it had to be injected just now.',
      environment.hostGranted
        ? `Chrome reports access to ${environment.host} as granted. This tab was carrying a content script left over from an earlier extension reload; it has just been replaced, and the background worker will keep doing that automatically from now on.`
        : `Chrome has NOT granted access to ${environment.host}. Open chrome://extensions, press Details on Markdown PR Diff, and set Site access to "On all sites".`,
      `granted origins: ${environment.grantedOrigins.join(', ') || '(none)'}`,
      `manifest matches: ${environment.manifestMatches.join(', ') || '(none)'}`,
      '',
    );
  }

  lines.push(
    `files page: ${report.isFilesPage ? 'yes' : 'no'}`,
    `markdown paths found: ${report.candidates.length}`,
    `file headers resolved: ${report.blocks.length}`,
  );
  for (const block of report.blocks.slice(0, 5)) lines.push(`  • ${block.path}`);
  if (report.blocks.length === 0 && report.candidates.length > 0) {
    lines.push('', 'Paths were found but no header could be resolved around them.');
  }
  if (report.candidates.length === 0) {
    lines.push('', 'No markdown file path was recognised anywhere on the page.');
  }
  lines.push('', 'Use "Copy report" and send it along to get the selectors fixed.');
  return lines.join('\n');
}

function addCopyButton(container: HTMLElement, payload: string): void {
  const button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.textContent = 'Copy report';
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(payload).then(() => {
      button.textContent = 'Copied';
    });
  });
  container.appendChild(document.createElement('br'));
  container.appendChild(button);
}

/** The GitHub host of the active tab, so the popup reports the relevant account. */
async function activeHost(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return DOT_COM;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return DOT_COM;
  }
}

/**
 * Whether the extension may act on a host without being clicked first.
 *
 * Chrome lets the user restrict an extension to "on click" per site. The
 * content script is then never injected automatically, so the button never
 * appears — while anything launched from the popup still works, because
 * clicking the icon grants access for that one visit. That combination is
 * baffling from the outside, so it gets said out loud.
 */
async function siteAccessGranted(host: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [`https://${host}/*`] });
  } catch {
    return true;
  }
}

// Which build is actually loaded, rather than which one was last written.
document.querySelector('#build')!.textContent = `build ${BUILD_STAMP}`;

async function main(): Promise<void> {
  let settings: Settings = await loadSettings();
  showButton.checked = settings.showButton;
  showComments.checked = settings.showComments;

  showButton.addEventListener('change', async () => {
    settings = await saveSettings({ showButton: showButton.checked });
  });
  showComments.addEventListener('change', async () => {
    settings = await saveSettings({ showComments: showComments.checked });
  });

  const host = await activeHost();

  if (!(await siteAccessGranted(host))) {
    statusEl.replaceChildren();
    statusEl.appendChild(
      document.createTextNode(
        `This extension is not allowed to run on ${host} automatically, so the button cannot appear. ` +
          'Open chrome://extensions, press Details on Markdown PR Diff, and set Site access to ' +
          '"On all sites" — then reload the pull request tab.',
      ),
    );
    statusEl.classList.add('notice-error');
    return;
  }

  try {
    const status = await send({ type: 'auth:status', host });
    statusEl.textContent = status.connected
      ? `${host}: connected as @${status.viewer?.login ?? '?'}`
      : `${host}: read-only — connect in settings to post comments`;
  } catch (error) {
    statusEl.textContent = `${host}: ${String(error)}`;
  }
}

void main();
