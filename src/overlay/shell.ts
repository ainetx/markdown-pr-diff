/**
 * The overlay window.
 *
 * Everything the extension draws lives in here, inside a shadow root on top of
 * the page. The pull request's own DOM is never touched: the only thing the
 * extension adds to GitHub's markup is the button that opens this.
 */

import overlayCss from './styles.css?inline';
import { DOC_CLASS, renderDiff, type RenderedDiff } from '@core/renderDiff';
import type { FileDiffPayload, ReviewComment, ReviewThread } from '@shared/github';
import { BUILD_STAMP } from '@shared/config';
import { send } from '@shared/messages';
import type { Layout, Settings } from '@shared/settings';
import { saveSettings } from '@shared/settings';
import { containKeyboardEvents } from './keyboard';
import { createDocumentView } from './document';
import { createSideBySide } from './sideBySide';
import { createThreadLayer, type ThreadActions, type ThreadLayer } from './threads';
import { createUnified } from './unified';
import { wholeFileKind, type DiffView } from './view';

export interface OverlayHandle {
  close(): void;
}

export interface OverlayOptions {
  payload: FileDiffPayload;
  settings: Settings;
}

/** The layouts, in the order the toolbar button cycles through them. */
const LAYOUTS: Record<Layout, { glyph: string; title: string; next: Layout }> = {
  'side-by-side': {
    glyph: '⇆',
    title: 'Side by side — click for unified',
    next: 'unified',
  },
  unified: {
    glyph: '≡',
    title: 'Unified — click to read the document',
    next: 'document',
  },
  document: {
    glyph: '▤',
    title: 'Reading view, no diff colouring — click for side by side',
    next: 'side-by-side',
  },
};

function detectTheme(): 'light' | 'dark' {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function button(doc: Document, label: string, title: string): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'mdpd-btn';
  el.textContent = label;
  el.title = title;
  return el;
}

export function openOverlay(options: OverlayOptions): OverlayHandle {
  const { payload } = options;
  const doc = document;

  const host = doc.createElement('div');
  host.className = 'mdpd-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const releaseKeyboard = containKeyboardEvents(host);

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayCss);
  shadow.adoptedStyleSheets = [sheet];

  const dialog = doc.createElement('dialog');
  dialog.className = 'mdpd-dialog';
  shadow.appendChild(dialog);

  const shell = doc.createElement('div');
  shell.className = 'mdpd-shell';
  dialog.appendChild(shell);

  // ----------------------------------------------------------- state

  const wholeFile = wholeFileKind(payload.baseText, payload.headText);

  let layout: Layout = options.settings.layout;
  let commentsVisible = options.settings.showComments;
  let view: DiffView | null = null;
  let threadLayer: ThreadLayer | null = null;
  let rendered: RenderedDiff | null = null;
  let threads: ReviewThread[] = [];

  const applyTheme = () => host.setAttribute('data-mdpd-theme', detectTheme());
  applyTheme();
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });

  // --------------------------------------------------------- toolbar

  const toolbar = doc.createElement('div');
  toolbar.className = 'mdpd-toolbar';

  const title = doc.createElement('span');
  title.className = 'mdpd-title';
  title.textContent = payload.file.path;

  // Visible, not hidden in a tooltip: which build is running must be readable
  // off any screenshot, instead of being argued about.
  const buildChip = doc.createElement('span');
  buildChip.className = 'mdpd-chip mdpd-build';
  buildChip.textContent = BUILD_STAMP;
  buildChip.title = 'Markdown PR Diff build';

  const stats = doc.createElement('span');
  stats.className = 'mdpd-stat';

  const layoutBtn = button(doc, '⇆', 'Switch layout');
  const commentsBtn = button(doc, '💬', 'Show or hide review comments');
  const prevBtn = button(doc, '↑', 'Previous change');
  const nextBtn = button(doc, '↓', 'Next change');
  const openBtn = button(doc, '⧉', 'Open this file on GitHub');
  const closeBtn = button(doc, '✕', 'Close (Esc)');

  const chip = doc.createElement('span');
  chip.className = 'mdpd-chip';
  chip.hidden = wholeFile === null;
  if (wholeFile) chip.textContent = wholeFile === 'added' ? 'New file' : 'Deleted file';

  // Whether comments can be written is otherwise invisible: the add-comment
  // affordance simply never appears, which is indistinguishable from a bug.
  const authChip = doc.createElement('span');
  authChip.className = 'mdpd-chip';
  authChip.textContent = payload.authenticated ? 'checking account…' : 'read-only';
  authChip.title = payload.authenticated
    ? ''
    : 'No GitHub account is connected, so comments cannot be read or posted.';

  // A wholly added or deleted file has nothing to compare, so the side-by-side
  // layout is meaningless for it — but the reading view still is, and so is
  // commenting. Only the step-through-changes controls go away.
  prevBtn.hidden = wholeFile !== null;
  nextBtn.hidden = wholeFile !== null;

  toolbar.append(
    title,
    buildChip,
    chip,
    authChip,
    stats,
    layoutBtn,
    commentsBtn,
    prevBtn,
    nextBtn,
    openBtn,
    closeBtn,
  );
  shell.appendChild(toolbar);

  const banner = doc.createElement('div');
  banner.className = 'mdpd-banner';
  banner.hidden = true;
  shell.appendChild(banner);

  const content = doc.createElement('div');
  content.className = 'mdpd-content';
  shell.appendChild(content);

  const outdatedHost = doc.createElement('div');
  outdatedHost.className = 'mdpd-outdated-host';
  outdatedHost.hidden = true;
  shell.appendChild(outdatedHost);

  function showError(message: string): void {
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearError(): void {
    banner.hidden = true;
  }

  // ------------------------------------------------- comment actions

  async function refreshThreads(): Promise<void> {
    if (!payload.authenticated) return;
    try {
      threads = await send({
        type: 'threads:list',
        pullRequest: payload.pullRequest,
        path: payload.file.path,
      });
      threadLayer?.render(threads);
      threadLayer?.setVisible(commentsVisible);
      clearError();
    } catch (error) {
      showError(`Could not load review comments: ${describe(error)}`);
    }
  }

  const actions: ThreadActions = {
    canWrite: payload.authenticated,
    readOnlyReason: 'Connect a GitHub account in the extension settings to reply from here.',
    async reply(thread: ReviewThread, body: string) {
      const last = thread.comments[thread.comments.length - 1];
      if (!last) throw new Error('This thread has no comment to reply to.');
      await send({
        type: 'comment:reply',
        pullRequest: payload.pullRequest,
        replyTo: last.databaseId,
        body,
      });
      await refreshThreads();
    },
    async create(input) {
      await send({ type: 'comment:create', pullRequest: payload.pullRequest, input });
      await refreshThreads();
    },
    async setResolved(thread, resolved) {
      await send({
        type: 'thread:resolve',
        pullRequest: payload.pullRequest,
        threadId: thread.id,
        resolved,
      });
      await refreshThreads();
    },
    async update(comment: ReviewComment, body: string) {
      await send({
        type: 'comment:update',
        pullRequest: payload.pullRequest,
        databaseId: comment.databaseId,
        body,
      });
      await refreshThreads();
    },
    async remove(comment: ReviewComment) {
      await send({
        type: 'comment:delete',
        pullRequest: payload.pullRequest,
        databaseId: comment.databaseId,
      });
      await refreshThreads();
    },
  };

  // --------------------------------------------------------- rendering

  function buildView(result: RenderedDiff): DiffView {
    // Reading view: one version, no diff colouring, still commentable.
    if (layout === 'document') {
      const side = wholeFile === 'removed' ? 'old' : 'new';
      return createDocumentView({
        content: side === 'old' ? result.oldPane : result.newPane,
        side,
        label:
          side === 'old'
            ? `Base · ${payload.pullRequest.baseSha.slice(0, 7)}`
            : `Head · ${payload.pullRequest.headSha.slice(0, 7)}`,
      });
    }

    // Side by side needs two versions; a wholly added or deleted file has one.
    if (layout === 'unified' || wholeFile !== null) {
      return createUnified({
        oldDoc: result.oldPane,
        newDoc: result.newPane,
        regions: result.diff.regions,
        oldLineCount: result.diff.oldLineCount,
      });
    }

    return createSideBySide({
      oldDoc: result.oldPane,
      newDoc: result.newPane,
      oldLabel: `Base · ${payload.pullRequest.baseSha.slice(0, 7)}`,
      newLabel: `Head · ${payload.pullRequest.headSha.slice(0, 7)}`,
      regions: result.diff.regions,
      oldLineCount: result.diff.oldLineCount,
    });
  }

  function renderBody(): void {
    threadLayer?.destroy();
    view?.destroy();
    content.replaceChildren();

    rendered = renderDiff({
      oldText: payload.baseText,
      newText: payload.headText,
      oldBases: { asset: payload.baseAssetUrl, link: payload.baseLinkUrl },
      newBases: { asset: payload.headAssetUrl, link: payload.headLinkUrl },
    });

    view = buildView(rendered);

    content.appendChild(view.root);

    // Highlighting every block of a wholly new or wholly deleted file is noise;
    // the chip in the toolbar already says what happened.
    if (wholeFile) view.root.querySelector(`.${DOC_CLASS}`)?.classList.add('mdpd-whole-file');

    stats.replaceChildren();
    const added = doc.createElement('span');
    added.className = 'mdpd-stat-add';
    added.textContent = `+${rendered.stats.added + rendered.stats.modified}`;
    const removed = doc.createElement('span');
    removed.className = 'mdpd-stat-del';
    removed.textContent = `−${rendered.stats.removed + rendered.stats.modified}`;
    stats.append(added, doc.createTextNode(' '), removed);

    layoutBtn.textContent = LAYOUTS[layout].glyph;
    layoutBtn.title = LAYOUTS[layout].title;
    layoutBtn.setAttribute('aria-pressed', String(layout !== 'side-by-side'));
    commentsBtn.setAttribute('aria-pressed', String(commentsVisible));

    threadLayer = createThreadLayer({
      doc,
      view,
      anchors: rendered.anchors,
      outdatedHost,
      draftBase: {
        host: payload.pullRequest.host,
        owner: payload.pullRequest.owner,
        repo: payload.pullRequest.repo,
        number: payload.pullRequest.number,
        path: payload.file.path,
      },
      commentable: payload.commentableLines,
      actions,
    });
    threadLayer.render(threads);
    threadLayer.setVisible(commentsVisible);

    view.refresh();
  }

  // ---------------------------------------------------------- wiring

  layoutBtn.addEventListener('click', () => {
    layout = LAYOUTS[layout].next;
    void saveSettings({ layout });
    renderBody();
  });

  commentsBtn.addEventListener('click', () => {
    commentsVisible = !commentsVisible;
    commentsBtn.setAttribute('aria-pressed', String(commentsVisible));
    threadLayer?.setVisible(commentsVisible);
    void saveSettings({ showComments: commentsVisible });
  });

  prevBtn.addEventListener('click', () => view?.goToChange(-1));
  nextBtn.addEventListener('click', () => view?.goToChange(1));

  openBtn.addEventListener('click', () => {
    const { host: ghHost, headOwner, headRepo, headSha } = payload.pullRequest;
    window.open(
      `https://${ghHost}/${headOwner}/${headRepo}/blob/${headSha}/${payload.file.path}`,
      '_blank',
      'noopener',
    );
  });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    releaseKeyboard();
    themeObserver.disconnect();
    threadLayer?.destroy();
    view?.destroy();
    if (dialog.open) dialog.close();
    host.remove();
  }

  closeBtn.addEventListener('click', close);
  dialog.addEventListener('close', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    // A click that lands on the dialog itself is a click on the backdrop.
    if (event.target === dialog) close();
  });

  doc.body.appendChild(host);
  dialog.showModal();

  renderBody();

  if (!payload.authenticated) {
    showError(
      'Read-only: no GitHub account is connected, so review comments are not shown and cannot be posted. Connect one in the extension settings.',
    );
  } else {
    void refreshThreads();
    void describeAccount();
  }

  /** Names the account in the toolbar, and says plainly when it cannot write. */
  async function describeAccount(): Promise<void> {
    try {
      const status = await send({ type: 'auth:status', host: payload.pullRequest.host });
      if (!status.connected) {
        authChip.textContent = 'read-only';
        return;
      }
      authChip.textContent = `@${status.viewer?.login ?? 'connected'}`;
      authChip.classList.add('is-ok');
      if (status.missingScopes.length > 0) {
        showError(
          `This token is missing the ${status.missingScopes.join(', ')} scope. Comments can be read but not posted.`,
        );
      }
    } catch {
      authChip.textContent = 'account unknown';
    }
  }

  return { close };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
