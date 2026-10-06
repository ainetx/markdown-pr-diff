/**
 * Review comments inside the overlay.
 *
 * Threads are placed against the rendered document through the same line map
 * the diff classification uses: GitHub addresses a comment by (side, line),
 * and every rendered block knows which lines it came from. A thread therefore
 * lands under the paragraph, row or list item it is actually about.
 *
 * Threads whose anchor no longer exists (GitHub calls them outdated) have no
 * honest place in the document, so they are collected into their own section
 * rather than attached to whichever block happens to be nearby.
 */

import type { AnchorIndex } from '@core/anchor';
import { renderMarkdownFragment } from '@core/renderMarkdown';
import { diffSideToSide, type Side } from '@core/types';
import type { NewCommentInput, ReviewComment, ReviewThread } from '@shared/github';
import { createComposer } from './composer';
import type { DraftKey } from './drafts';
import type { DiffView } from './view';

const THREAD_CLASS = 'mdpd-thread';
const BADGE_CLASS = 'mdpd-comment-badge';
const ADD_BUTTON_CLASS = 'mdpd-add-comment';
const COMMENTABLE_CLASS = 'mdpd-commentable';

export interface ThreadActions {
  canWrite: boolean;
  /** Why writing is unavailable, shown in place of the composer. */
  readOnlyReason: string;
  reply(thread: ReviewThread, body: string): Promise<void>;
  create(input: NewCommentInput): Promise<void>;
  setResolved(thread: ReviewThread, resolved: boolean): Promise<void>;
  update(comment: ReviewComment, body: string): Promise<void>;
  remove(comment: ReviewComment): Promise<void>;
}

export interface ThreadLayerOptions {
  doc: Document;
  view: DiffView;
  anchors: Record<Side, AnchorIndex>;
  /** Container below the diff for threads that lost their anchor. */
  outdatedHost: HTMLElement;
  draftBase: Omit<DraftKey, 'slot'>;
  /** Lines GitHub will accept a comment on, per side. */
  commentable: { left: number[]; right: number[] };
  actions: ThreadActions;
}

export interface ThreadLayer {
  render(threads: readonly ReviewThread[]): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

// --------------------------------------------------------------- utilities

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2592000, 'day'],
    [31536000, 'month'],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let previous = 1;
  for (const [limit, unit] of units) {
    if (seconds < limit) return formatter.format(-Math.round(seconds / previous), unit);
    previous = limit;
  }
  return formatter.format(-Math.round(seconds / 31536000), 'year');
}

/** The ancestor that is a direct child of the rendered document root. */
function topLevelAncestor(element: Element, root: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current && current.parentElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current?.parentElement === root ? (current as HTMLElement) : null;
}

// ------------------------------------------------------------------- layer

export function createThreadLayer(options: ThreadLayerOptions): ThreadLayer {
  const { doc, view, actions } = options;
  const referenceContext = {
    host: options.draftBase.host,
    owner: options.draftBase.owner,
    repo: options.draftBase.repo,
  };
  const mounted: HTMLElement[] = [];
  /** Observers and listeners to release when the layer goes away. */
  const teardown: (() => void)[] = [];
  let visible = true;
  /** The composer currently open for a new comment, and the block it belongs to. */
  let openComposer: { block: HTMLElement; wrapper: HTMLElement; destroy(): void } | null = null;

  /**
   * Whether a composer is genuinely on screen for a block.
   *
   * Checks the DOM rather than trusting the handle. A re-render can take the
   * composer away without going through `close`, and a handle left behind
   * then strands the add button showing "×" with nothing to discard.
   */
  function composerOpenFor(block: HTMLElement | null): boolean {
    if (!openComposer || openComposer.block !== block) return false;
    if (openComposer.wrapper.isConnected) return true;
    openComposer = null;
    return false;
  }
  /** Redraws the add button for whichever block it is sitting on. */
  const refreshAddButtons: (() => void)[] = [];
  /** Re-measures a pane and re-applies its commentable marks. */
  const remeasure: (() => void)[] = [];

  const commentableBySide: Record<Side, Set<number>> = {
    old: new Set(options.commentable.left),
    new: new Set(options.commentable.right),
  };

  /**
   * The span of a block that GitHub will actually accept a comment on.
   *
   * A rendered block covers a run of file lines, but only the ones inside a
   * diff hunk can carry a comment. Anchoring to the block's last line — which
   * is often an untouched line well outside any hunk — is what produced
   * "pull_request_review_thread.line: could not be resolved".
   */
  function commentableSpan(
    side: Side,
    range: { start: number; end: number },
  ): { start: number; end: number } | null {
    const lines = commentableBySide[side];
    let first: number | null = null;
    let last: number | null = null;
    for (let line = range.start; line <= range.end; line++) {
      if (!lines.has(line)) continue;
      first ??= line;
      last = line;
    }
    return first !== null && last !== null ? { start: first, end: last } : null;
  }

  function clear(): void {
    for (const node of mounted) node.remove();
    mounted.length = 0;
    // A re-render removes the composer's wrapper along with everything else;
    // leaving the handle behind would strand the add button showing "×".
    openComposer = null;
    for (const repaint of refreshAddButtons) repaint();
    for (const badge of view.root.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove();
    options.outdatedHost.replaceChildren();
    options.outdatedHost.hidden = true;
  }

  function place(thread: ReviewThread): boolean {
    const side: Side = diffSideToSide(thread.side);
    const line = thread.line;
    if (line === null) return false;

    const root = view.docFor(side);
    const anchor = options.anchors[side].elementForLine(line);
    if (!anchor || !root.contains(anchor)) return false;

    // A thread card is a block element; inserting it after a <tr> or <li>
    // would corrupt the table or list, so it goes after the whole block.
    const host = topLevelAncestor(anchor, root);
    if (!host) return false;

    const card = renderThread(thread);
    root.insertBefore(card, host.nextSibling);
    mounted.push(card);

    anchor.appendChild(badgeFor(thread, card));
    return true;
  }

  function badgeFor(thread: ReviewThread, card: HTMLElement): HTMLElement {
    const unresolved = thread.isResolved ? 0 : thread.comments.length;
    const badge = el(doc, 'button', BADGE_CLASS, `💬 ${thread.comments.length}`);
    badge.setAttribute('type', 'button');
    badge.title = thread.isResolved ? 'Resolved thread' : `${unresolved} comment(s)`;
    if (thread.isResolved) badge.classList.add('is-resolved');
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.add('is-flashed');
      setTimeout(() => card.classList.remove('is-flashed'), 1200);
    });
    return badge;
  }

  function renderComment(thread: ReviewThread, comment: ReviewComment): HTMLElement {
    const card = el(doc, 'div', 'mdpd-comment');

    const head = el(doc, 'div', 'mdpd-comment-head');
    if (comment.author) {
      const avatar = el(doc, 'img', 'mdpd-avatar');
      avatar.src = comment.author.avatarUrl;
      avatar.alt = '';
      avatar.width = 20;
      avatar.height = 20;
      head.appendChild(avatar);
    }
    head.appendChild(el(doc, 'span', 'mdpd-author', comment.author?.login ?? 'ghost'));
    head.appendChild(el(doc, 'span', 'mdpd-time', relativeTime(comment.createdAt)));

    const link = el(doc, 'a', 'mdpd-comment-link', 'on GitHub');
    link.href = comment.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    head.appendChild(link);

    const body = el(doc, 'div', 'md-diff-doc mdpd-comment-body');
    body.appendChild(
      renderMarkdownFragment(comment.bodyMarkdown, doc, { references: referenceContext }),
    );

    card.append(head, body);

    if (actions.canWrite && comment.viewerDidAuthor) {
      const tools = el(doc, 'div', 'mdpd-comment-tools');

      const edit = el(doc, 'button', 'mdpd-link-btn', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => {
        const composer = createComposer({
          doc,
          references: referenceContext,
          draftKey: { ...options.draftBase, slot: `edit:${comment.databaseId}` },
          submitLabel: 'Update',
          placeholder: 'Edit this comment',
          onSubmit: async (text) => {
            await actions.update(comment, text);
          },
          onCancel: () => {
            composer.destroy();
            body.hidden = false;
            tools.hidden = false;
          },
        });
        body.hidden = true;
        tools.hidden = true;
        card.appendChild(composer.root);
        composer.focus();
      });

      const remove = el(doc, 'button', 'mdpd-link-btn mdpd-danger', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        remove.disabled = true;
        void actions.remove(comment).catch(() => {
          remove.disabled = false;
        });
      });

      tools.append(edit, remove);
      card.appendChild(tools);
    }

    void thread;
    return card;
  }

  function renderThread(thread: ReviewThread): HTMLElement {
    const card = el(doc, 'div', THREAD_CLASS);
    if (thread.isResolved) card.classList.add('is-resolved');
    card.hidden = !visible;

    const header = el(doc, 'div', 'mdpd-thread-head');
    const participants = [
      ...new Set(thread.comments.map((c) => c.author?.login).filter(Boolean)),
    ].join(', ');
    header.appendChild(el(doc, 'span', 'mdpd-thread-who', participants || 'Review thread'));

    if (thread.isOutdated) header.appendChild(el(doc, 'span', 'mdpd-chip', 'outdated'));
    if (thread.isResolved) header.appendChild(el(doc, 'span', 'mdpd-chip is-ok', 'resolved'));

    const canToggle = thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve;
    if (actions.canWrite && canToggle) {
      const toggle = el(doc, 'button', 'mdpd-btn', thread.isResolved ? 'Unresolve' : 'Resolve');
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        toggle.disabled = true;
        void actions.setResolved(thread, !thread.isResolved).catch(() => {
          toggle.disabled = false;
        });
      });
      header.appendChild(toggle);
    }

    // Resolved threads start collapsed, matching GitHub.
    const bodyWrap = el(doc, 'div', 'mdpd-thread-body');
    bodyWrap.hidden = thread.isResolved;
    if (thread.isResolved) {
      const expand = el(doc, 'button', 'mdpd-link-btn', 'Show thread');
      expand.type = 'button';
      expand.addEventListener('click', () => {
        bodyWrap.hidden = !bodyWrap.hidden;
        expand.textContent = bodyWrap.hidden ? 'Show thread' : 'Hide thread';
      });
      header.appendChild(expand);
    }

    for (const comment of thread.comments) bodyWrap.appendChild(renderComment(thread, comment));

    if (actions.canWrite) {
      const replyBtn = el(doc, 'button', 'mdpd-btn', 'Reply');
      replyBtn.type = 'button';
      replyBtn.addEventListener('click', () => {
        replyBtn.hidden = true;
        const composer = createComposer({
          doc,
          references: referenceContext,
          draftKey: { ...options.draftBase, slot: `reply:${thread.id}` },
          submitLabel: 'Reply',
          placeholder: 'Leave a reply',
          onSubmit: async (text) => {
            await actions.reply(thread, text);
          },
          onCancel: () => {
            composer.destroy();
            replyBtn.hidden = false;
          },
        });
        bodyWrap.appendChild(composer.root);
        composer.focus();
      });
      bodyWrap.appendChild(replyBtn);
    } else {
      bodyWrap.appendChild(el(doc, 'div', 'mdpd-hint', actions.readOnlyReason));
    }

    card.append(header, bodyWrap);
    return card;
  }

  function renderOutdated(threads: readonly ReviewThread[]): void {
    if (threads.length === 0) return;
    options.outdatedHost.hidden = !visible;

    const details = el(doc, 'details', 'mdpd-outdated');
    details.appendChild(
      el(doc, 'summary', undefined, `Outdated comments (${threads.length})`) as HTMLElement,
    );

    for (const thread of threads) {
      const wrap = el(doc, 'div', 'mdpd-outdated-thread');
      if (thread.diffHunk) {
        const hunk = el(doc, 'pre', 'mdpd-hunk', thread.diffHunk);
        wrap.appendChild(hunk);
      }
      wrap.appendChild(renderThread(thread));
      details.appendChild(wrap);
    }

    options.outdatedHost.appendChild(details);
  }

  // ------------------------------------------------- new-comment affordance

  function attachAddButtons(): void {
    if (!actions.canWrite) return;
    for (const side of ['old', 'new'] as const) {
      const scroller = view.scrollerFor(side);
      const root = view.docFor(side);
      if (scroller.querySelector(`.${ADD_BUTTON_CLASS}`)) continue;

      const button = el(doc, 'button', ADD_BUTTON_CLASS, '+');
      button.type = 'button';
      button.title = 'Comment on this block';
      button.hidden = true;
      scroller.appendChild(button);

      let target: HTMLElement | null = null;

      interface Band {
        el: HTMLElement;
        top: number;
        bottom: number;
        /** False for blocks GitHub would refuse a comment on. */
        commentable: boolean;
      }

      /**
       * Vertical extent of every block, in the scroller's own coordinates.
       *
       * Blocks that cannot take a comment are measured too, deliberately:
       * knowing where they are is what stops the button from drifting onto a
       * neighbour and silently anchoring a comment to the wrong place.
       * Measured lazily and dropped whenever the content resizes, so a
       * mousemove costs a lookup rather than a layout pass.
       */
      let bands: Band[] | null = null;

      function measure(): Band[] {
        const scrollerTop = scroller.getBoundingClientRect().top - scroller.scrollTop;

        // The most specific element carrying lines, not just the top-level
        // block: that is what makes a single table row or list item
        // commentable instead of the whole table or list at once.
        const candidates = [...root.querySelectorAll<HTMLElement>('[data-line-start]')].filter(
          (el) => !el.closest(`.${THREAD_CLASS}`) && el.querySelector('[data-line-start]') === null,
        );

        bands = candidates.map((el) => {
          const box = el.getBoundingClientRect();
          const commentable =
            commentableSpan(view.sideFor(el), readRange(el) ?? { start: 0, end: -1 }) !== null;
          // Marked in the document itself, not only on hover: in the reading
          // view there is no colouring to go by, so where a comment can go
          // has to be visible without sweeping the pointer over the page.
          el.classList.toggle(COMMENTABLE_CLASS, commentable);
          return { el, top: box.top - scrollerTop, bottom: box.bottom - scrollerTop, commentable };
        });
        return bands;
      }

      // Anything that changes the content's height invalidates the bands:
      // a thread appearing, a composer opening, an image finishing.
      const resize =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              bands = null;
              // Opening a composer moves everything below it. Without
              // re-placing the button it would hang beside the wrong block.
              if (!target || button.hidden) return;
              const band = (bands ?? measure()).find((entry) => entry.el === target);
              if (band) button.style.top = `${band.top}px`;
            });
      resize?.observe(root);

      /** How far outside a block still counts as pointing at it. */
      const GAP_TOLERANCE = 10;

      /**
       * The block the pointer is level with.
       *
       * Strictly the one it is actually on, or just beside within the margin
       * between blocks. Never "the nearest one in that direction": that is
       * what let the button sit next to a paragraph with no diff while
       * secretly pointing at another block further up.
       */
      function bandAt(contentY: number): Band | null {
        const measured = bands ?? measure();
        let nearest: Band | null = null;
        let nearestDistance = Infinity;

        for (const band of measured) {
          if (contentY >= band.top && contentY <= band.bottom) return band;
          const distance = contentY < band.top ? band.top - contentY : contentY - band.bottom;
          if (distance < nearestDistance) {
            nearest = band;
            nearestDistance = distance;
          }
        }

        return nearestDistance <= GAP_TOLERANCE ? nearest : null;
      }

      /** The block an event landed on, if it landed on one. */
      function directHit(node: EventTarget | null): Band | null {
        const measured = bands ?? measure();
        let el = node instanceof Element ? node.closest<HTMLElement>('[data-line-start]') : null;
        while (el) {
          const found = measured.find((band) => band.el === el);
          if (found) return found;
          el = el.parentElement?.closest<HTMLElement>('[data-line-start]') ?? null;
        }
        return null;
      }

      // A direct hit while the pointer is over the text, the block at the same
      // height otherwise. Going by height is what keeps the button reachable
      // across the gutter, since moving sideways does not change it.
      scroller.addEventListener('mousemove', (event) => {
        const contentY = event.clientY - scroller.getBoundingClientRect().top + scroller.scrollTop;
        const band = directHit(event.target) ?? bandAt(contentY);

        if (!band || !band.commentable) {
          // Nothing to offer here. Saying so is better than parking the button
          // beside a block it does not belong to.
          if (composerOpenFor(target)) return;
          button.hidden = true;
          target = null;
          return;
        }

        if (band.el === target) return;
        target = band.el;
        button.style.top = `${band.top}px`;
        button.hidden = false;
        paint();
      });

      scroller.addEventListener('mouseleave', () => {
        // Keep it while this block's composer is open, so the way to close
        // it does not disappear the moment the pointer drifts off.
        if (composerOpenFor(target)) return;
        button.hidden = true;
        target = null;
      });

      // Scrolling needs no invalidation: the bands are measured in the
      // scroller's content coordinates, which scrolling does not move.

      teardown.push(() => resize?.disconnect());

      // The marks are a property of the document, not of hovering it, so they
      // are applied when the pane is rendered rather than on first pointer
      // movement.
      remeasure.push(() => {
        bands = null;
        measure();
      });

      /** The button is a toggle: it opens the composer, then closes it again. */
      function paint() {
        const open = composerOpenFor(target);
        button.textContent = open ? '×' : '+';
        button.title = open ? 'Discard this comment' : 'Comment on this block';
        button.classList.toggle('is-open', open);
      }
      refreshAddButtons.push(paint);
      teardown.push(() => {
        const index = refreshAddButtons.indexOf(paint);
        if (index >= 0) refreshAddButtons.splice(index, 1);
      });

      button.addEventListener('click', () => {
        if (!target) return;
        if (composerOpenFor(target)) {
          openComposer?.destroy();
          return;
        }
        startNewComment(view.sideFor(target), target);
      });
    }
  }

  function startNewComment(side: Side, block: HTMLElement): void {
    openComposer?.destroy();

    const blockRange = options.anchors[side].rangeForElement(block) ?? readRange(block);
    if (!blockRange) return;

    // Narrow the block's line range down to what GitHub will accept.
    const range = commentableSpan(side, blockRange);
    if (!range) return;

    const diffSide = side === 'old' ? 'LEFT' : 'RIGHT';
    const wrapper = el(doc, 'div', `${THREAD_CLASS} mdpd-thread-new`);
    const composer = createComposer({
      doc,
      references: referenceContext,
      draftKey: { ...options.draftBase, slot: `new:${side}:${range.end}` },
      submitLabel: 'Comment',
      placeholder: 'Comment on this block',
      onSubmit: async (body) => {
        await actions.create({
          path: options.draftBase.path,
          side: diffSide,
          line: range.end,
          startLine: range.start === range.end ? undefined : range.start,
          startSide: diffSide,
          body,
        });
        // The refresh that follows a successful post re-renders everything,
        // but the handle has to go too or the add button keeps showing "×".
        close();
      },
      onCancel: () => close(),
    });

    function close() {
      wrapper.remove();
      openComposer = null;
      for (const repaint of refreshAddButtons) repaint();
    }

    wrapper.appendChild(composer.root);
    // The comment is anchored to this exact row or item, but the form itself
    // is a block element: putting it inside a table or list would corrupt
    // them, so it goes after the whole structure.
    const root = view.docFor(side);
    const host = topLevelAncestor(block, root) ?? block;
    host.parentNode?.insertBefore(wrapper, host.nextSibling);
    mounted.push(wrapper);
    composer.focus();
    openComposer = { block, wrapper, destroy: close };
    for (const repaint of refreshAddButtons) repaint();
  }

  function readRange(block: HTMLElement): { start: number; end: number } | null {
    const start = Number(block.getAttribute('data-line-start'));
    const end = Number(block.getAttribute('data-line-end'));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  }

  // ------------------------------------------------------------------ api

  return {
    render(threads: readonly ReviewThread[]): void {
      clear();
      const orphans: ReviewThread[] = [];
      for (const thread of threads) {
        if (!place(thread)) orphans.push(thread);
      }
      renderOutdated(orphans);
      attachAddButtons();
      for (const apply of remeasure) apply();
    },

    setVisible(next: boolean): void {
      visible = next;
      for (const node of mounted) node.hidden = !next;
      for (const badge of view.root.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)) {
        badge.hidden = !next;
      }
      options.outdatedHost.hidden = !next || options.outdatedHost.childElementCount === 0;
    },

    destroy(): void {
      clear();
      for (const marked of view.root.querySelectorAll(`.${COMMENTABLE_CLASS}`)) {
        marked.classList.remove(COMMENTABLE_CLASS);
      }
      remeasure.length = 0;
      for (const release of teardown.splice(0)) release();
      for (const button of view.root.querySelectorAll(`.${ADD_BUTTON_CLASS}`)) button.remove();
    },
  };
}
