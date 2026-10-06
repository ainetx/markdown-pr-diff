/**
 * The two-pane view: synchronized scrolling, vertical alignment and the
 * scrollbar minimap.
 *
 * Ported from markdown-diff-visualiser's src/webview/main.js (MIT, see NOTICE).
 * `syncScroll`, `waitForImages` and the minimap keep upstream's behaviour.
 * Alignment does not: upstream paired blocks by comparing the first 80
 * characters of their text, which mismatches whenever two blocks start alike
 * and silently gives up on anything that is not a direct child. Here the panes
 * are paired through the diff's own line correspondence, which is exact.
 */

import { buildLineMapping } from '@core/lineMapping';
import { readLineRange } from '@core/lineMap';
import type { ChangeRegion } from '@core/types';
import { ADDED_CLASS, REMOVED_CLASS } from '@core/classify';
import type { Side } from '@core/types';
import type { DiffView } from './view';

const SPACER_CLASS = 'alignment-spacer';
const IMAGE_TIMEOUT_MS = 3000;

export interface SideBySideOptions {
  oldDoc: HTMLElement;
  newDoc: HTMLElement;
  oldLabel: string;
  newLabel: string;
  regions: readonly ChangeRegion[];
  oldLineCount: number;
  doc?: Document;
}

export type SideBySideView = DiffView;

function topWithin(el: HTMLElement, pane: HTMLElement): number {
  return el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
}

/** Runs `callback` once every image has settled, or after a short grace period. */
function waitForImages(root: ParentNode, callback: () => void): () => void {
  const images = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  let done = false;
  let pending = images.length;

  const finish = () => {
    if (done) return;
    done = true;
    callback();
  };

  const settle = () => {
    pending -= 1;
    if (pending <= 0) finish();
  };

  for (const img of images) {
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', settle, { once: true });
  }

  if (pending === 0) {
    requestAnimationFrame(() => requestAnimationFrame(finish));
  }

  const timer = setTimeout(finish, IMAGE_TIMEOUT_MS);
  return () => {
    done = true;
    clearTimeout(timer);
  };
}

export function createSideBySide(options: SideBySideOptions): DiffView {
  const doc = options.doc ?? document;

  const root = doc.createElement('div');
  root.className = 'mdpd-body';

  function pane(label: string, content: HTMLElement, emptyText: string) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'mdpd-pane-wrapper';

    const labelEl = doc.createElement('div');
    labelEl.className = 'mdpd-pane-label';
    labelEl.textContent = label;

    const scroller = doc.createElement('div');
    scroller.className = 'mdpd-pane';
    if (content.children.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'mdpd-empty';
      empty.textContent = emptyText;
      scroller.appendChild(empty);
    } else {
      scroller.appendChild(content);
    }

    wrapper.append(labelEl, scroller);
    root.appendChild(wrapper);
    return scroller;
  }

  const oldScroller = pane(options.oldLabel, options.oldDoc, 'No previous version');
  const newScroller = pane(options.newLabel, options.newDoc, 'File deleted');

  // ------------------------------------------------------------- scrolling

  let syncing = false;
  function mirror(source: HTMLElement, target: HTMLElement) {
    if (syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  const onOldScroll = () => mirror(oldScroller, newScroller);
  const onNewScroll = () => mirror(newScroller, oldScroller);
  oldScroller.addEventListener('scroll', onOldScroll, { passive: true });
  newScroller.addEventListener('scroll', onNewScroll, { passive: true });

  // ------------------------------------------------------------ alignment

  function clearSpacers() {
    for (const spacer of root.querySelectorAll(`.${SPACER_CLASS}`)) spacer.remove();
  }

  function alignPanes() {
    clearSpacers();

    const mapping = buildLineMapping(options.regions, options.oldLineCount);

    const newByStartLine = new Map<number, HTMLElement>();
    for (const child of options.newDoc.children) {
      const range = readLineRange(child);
      if (range && !newByStartLine.has(range.start)) {
        newByStartLine.set(range.start, child as HTMLElement);
      }
    }

    // Anchor on blocks that exist unchanged in both versions.
    const anchors: { left: HTMLElement; right: HTMLElement }[] = [];
    for (const child of options.oldDoc.children) {
      const range = readLineRange(child);
      if (!range) continue;
      const mapped = mapping.toNew(range.start);
      if (mapped === null) continue;
      const counterpart = newByStartLine.get(mapped);
      if (counterpart) anchors.push({ left: child as HTMLElement, right: counterpart });
    }

    // Inserting a spacer between two blocks stops their vertical margins from
    // collapsing, so the shift it produces is not exactly its own height. One
    // corrective pass settles the residual; the loop stops as soon as nothing
    // moves, which is the common case after the second pass.
    for (let pass = 0; pass < 3; pass++) {
      let adjusted = false;
      for (const { left, right } of anchors) {
        const delta = Math.round(topWithin(left, oldScroller) - topWithin(right, newScroller));
        if (Math.abs(delta) <= 1) continue;
        const spacer = doc.createElement('div');
        spacer.className = SPACER_CLASS;
        spacer.style.height = `${Math.abs(delta)}px`;
        if (delta > 0) right.parentNode?.insertBefore(spacer, right);
        else left.parentNode?.insertBefore(spacer, left);
        adjusted = true;
      }
      if (!adjusted) break;
    }

    // Equalize the scroll range so 1:1 mirroring reaches the bottom on both sides.
    const difference = oldScroller.scrollHeight - newScroller.scrollHeight;
    if (Math.abs(difference) > 2) {
      const tail = doc.createElement('div');
      tail.className = SPACER_CLASS;
      tail.style.height = `${Math.abs(difference)}px`;
      (difference > 0 ? newScroller : oldScroller).appendChild(tail);
    }
  }

  // -------------------------------------------------------------- minimap

  function buildMinimap(scroller: HTMLElement, selector: string, kind: string) {
    const wrapper = scroller.parentElement;
    if (!wrapper) return;
    wrapper.querySelector('.scrollbar-minimap')?.remove();

    const blocks = [...scroller.querySelectorAll<HTMLElement>(selector)];
    const total = scroller.scrollHeight;
    if (blocks.length === 0 || total <= 0) return;

    const minimap = doc.createElement('div');
    minimap.className = 'scrollbar-minimap';

    for (const block of blocks) {
      const top = topWithin(block, scroller);
      const marker = doc.createElement('div');
      marker.className = `minimap-marker minimap-marker-${kind}`;
      marker.style.top = `${(top / total) * 100}%`;
      marker.style.height = `${Math.max((block.offsetHeight / total) * 100, 0.8)}%`;
      marker.addEventListener('click', () => {
        scroller.scrollTop = top - scroller.clientHeight / 2;
      });
      minimap.appendChild(marker);
    }

    wrapper.appendChild(minimap);
  }

  // --------------------------------------------------------- change cursor

  let changeCursor = -1;
  function changeTargets(): { scroller: HTMLElement; el: HTMLElement }[] {
    const targets: { scroller: HTMLElement; el: HTMLElement; top: number }[] = [];
    for (const el of options.newDoc.querySelectorAll<HTMLElement>(`.${ADDED_CLASS}`)) {
      targets.push({ scroller: newScroller, el, top: topWithin(el, newScroller) });
    }
    for (const el of options.oldDoc.querySelectorAll<HTMLElement>(`.${REMOVED_CLASS}`)) {
      targets.push({ scroller: oldScroller, el, top: topWithin(el, oldScroller) });
    }
    return targets.sort((a, b) => a.top - b.top);
  }

  function goToChange(direction: 1 | -1) {
    const targets = changeTargets();
    if (targets.length === 0) return;
    changeCursor = (changeCursor + direction + targets.length) % targets.length;
    const target = targets[changeCursor]!;
    const top = topWithin(target.el, target.scroller);
    target.scroller.scrollTop = top - target.scroller.clientHeight / 3;
  }

  // ------------------------------------------------------------- lifecycle

  function refresh() {
    alignPanes();
    buildMinimap(oldScroller, `.${REMOVED_CLASS}`, 'removed');
    buildMinimap(newScroller, `.${ADDED_CLASS}`, 'added');
  }

  const cancelImageWait = waitForImages(root, refresh);

  // Alignment depends on how wide the panes are, never on how tall. Reacting
  // to height would be self-defeating: inserting a spacer changes the height,
  // which would fire the observer, which would clear the spacers again.
  let lastWidth = -1;
  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          const width = Math.round(entries[0]?.contentRect.width ?? root.clientWidth);
          if (width === lastWidth) return;
          lastWidth = width;
          refresh();
        });
  resizeObserver?.observe(root);

  return {
    root,
    refresh,
    goToChange,
    scrollerFor: (side: Side) => (side === 'old' ? oldScroller : newScroller),
    docFor: (side: Side) => (side === 'old' ? options.oldDoc : options.newDoc),
    sideFor: (block: HTMLElement) => (options.oldDoc.contains(block) ? 'old' : 'new'),
    destroy() {
      cancelImageWait();
      resizeObserver?.disconnect();
      oldScroller.removeEventListener('scroll', onOldScroll);
      newScroller.removeEventListener('scroll', onNewScroll);
      root.remove();
    },
  };
}
