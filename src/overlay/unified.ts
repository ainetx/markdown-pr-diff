/**
 * The single-column view: the head document, with removed blocks spliced back
 * in at the position they used to occupy.
 *
 * The two panes are consumed here (their children are moved into one column),
 * which is why switching layouts re-renders rather than reusing the panes.
 */

import { readLineRange } from '@core/lineMap';
import { buildLineMapping } from '@core/lineMapping';
import { DOC_CLASS } from '@core/renderDiff';
import { ADDED_CLASS, REMOVED_CLASS } from '@core/classify';
import type { ChangeRegion, Side } from '@core/types';
import type { DiffView } from './view';

export interface UnifiedOptions {
  oldDoc: HTMLElement;
  newDoc: HTMLElement;
  regions: readonly ChangeRegion[];
  oldLineCount: number;
  doc?: Document;
}

export type UnifiedView = DiffView;

export function createUnified(options: UnifiedOptions): DiffView {
  const doc = options.doc ?? document;
  const mapping = buildLineMapping(options.regions, options.oldLineCount);

  const oldChildren = [...options.oldDoc.children] as HTMLElement[];
  const newChildren = [...options.newDoc.children] as HTMLElement[];

  // Blocks that survive the change appear once, taken from the head side.
  const newByStartLine = new Map<number, HTMLElement>();
  for (const child of newChildren) {
    const range = readLineRange(child);
    if (range && !newByStartLine.has(range.start)) newByStartLine.set(range.start, child);
  }

  const partnerOfOld = new Map<HTMLElement, HTMLElement>();
  const pairedNew = new Set<HTMLElement>();
  for (const child of oldChildren) {
    const range = readLineRange(child);
    if (!range) continue;
    const mapped = mapping.toNew(range.start);
    if (mapped === null) continue;
    const partner = newByStartLine.get(mapped);
    if (partner && !pairedNew.has(partner)) {
      partnerOfOld.set(child, partner);
      pairedNew.add(partner);
    }
  }

  /**
   * A paired block collapses into one copy only when nothing inside it
   * changed. If a table row or a list item differs, both versions are shown —
   * otherwise the "before" content would simply vanish from the unified view,
   * which is the one thing a diff must never do.
   */
  function hasInnerChange(element: HTMLElement): boolean {
    return (
      element.classList.contains(ADDED_CLASS) ||
      element.classList.contains(REMOVED_CLASS) ||
      element.querySelector(`.${ADDED_CLASS}, .${REMOVED_CLASS}`) !== null
    );
  }

  const column = doc.createElement('div');
  column.className = `${DOC_CLASS} mdpd-unified`;

  let i = 0;
  let j = 0;
  while (i < oldChildren.length || j < newChildren.length) {
    const oldEl = oldChildren[i];
    const newEl = newChildren[j];

    if (oldEl && !partnerOfOld.has(oldEl)) {
      // Only exists in the base version: show it as removed, in place.
      column.appendChild(oldEl);
      i += 1;
      continue;
    }
    if (newEl && !pairedNew.has(newEl)) {
      column.appendChild(newEl);
      j += 1;
      continue;
    }
    if (oldEl && newEl && partnerOfOld.get(oldEl) === newEl) {
      if (hasInnerChange(oldEl) || hasInnerChange(newEl)) column.append(oldEl, newEl);
      else column.appendChild(newEl);
      i += 1;
      j += 1;
      continue;
    }
    // Pairing disagrees with document order; emit in order and keep going
    // rather than dropping content.
    if (oldEl) {
      column.appendChild(oldEl);
      i += 1;
    } else if (newEl) {
      column.appendChild(newEl);
      j += 1;
    }
  }

  const root = doc.createElement('div');
  root.className = 'mdpd-body mdpd-body-unified';

  const scroller = doc.createElement('div');
  scroller.className = 'mdpd-pane';
  scroller.appendChild(column);
  root.appendChild(scroller);

  let cursor = -1;
  function goToChange(direction: 1 | -1) {
    const targets = [...column.querySelectorAll<HTMLElement>(`.${ADDED_CLASS}, .${REMOVED_CLASS}`)];
    if (targets.length === 0) return;
    cursor = (cursor + direction + targets.length) % targets.length;
    const target = targets[cursor]!;
    const top =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTop = top - scroller.clientHeight / 3;
  }

  return {
    root,
    goToChange,
    refresh: () => undefined,
    scrollerFor: (_side: Side) => scroller,
    docFor: (_side: Side) => column,
    destroy() {
      root.remove();
    },
  };
}
