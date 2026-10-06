/**
 * Keeping your place across a change of layout.
 *
 * Carrying the scroll offset over would be meaningless: the three layouts put
 * the same file at entirely different heights. What does survive is the line
 * of the file you were looking at, because line numbers are what every layout
 * is built from. So the position is remembered as "this line, this far below
 * the top of the pane" and restored by finding that line again.
 */

import { readLineRange } from '@core/lineMap';
import type { Side } from '@core/types';
import type { DiffView } from './view';

export interface ScrollAnchor {
  side: Side;
  /** Line of the file that was at the top of the pane. */
  line: number;
  /** How far below the top of the pane it sat, in pixels. */
  offset: number;
}

/** Every element carrying a line range, most specific first. */
function lineElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-line-start]')].filter(
    (el) => !el.closest('.mdpd-thread'),
  );
}

function topWithin(el: HTMLElement, scroller: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/** The side that actually has content, preferring the head version. */
function primarySide(view: DiffView): Side | null {
  for (const side of ['new', 'old'] as const) {
    if (view.docFor(side).children.length > 0) return side;
  }
  return null;
}

/**
 * The line at the top of the pane, and how far down it sits.
 *
 * Returns null when there is nothing to anchor to — an empty pane, or a
 * document with no line information at all.
 */
export function captureAnchor(view: DiffView): ScrollAnchor | null {
  const side = primarySide(view);
  if (!side) return null;

  const scroller = view.scrollerFor(side);
  const candidates = lineElements(view.docFor(side));

  // The first element still visible: the one whose bottom has not yet passed
  // the top of the pane.
  for (const el of candidates) {
    const box = el.getBoundingClientRect();
    const top = box.top - scroller.getBoundingClientRect().top;
    if (top + box.height <= 0) continue;

    const range = readLineRange(el);
    if (!range) continue;
    return { side: view.sideFor(el), line: range.start, offset: top };
  }

  return null;
}

/** The element showing a line, or the nearest one above it. */
function elementForLine(root: ParentNode, line: number): HTMLElement | null {
  const candidates = lineElements(root);
  let fallback: HTMLElement | null = null;

  for (const el of candidates) {
    const range = readLineRange(el);
    if (!range) continue;
    if (line >= range.start && line <= range.end) return el;
    if (range.start <= line) fallback = el;
  }

  return fallback ?? candidates[0] ?? null;
}

/**
 * Puts the remembered line back where it was.
 *
 * The line may not exist in the new layout — the reading view shows only one
 * version, so a line of the other one has no element. The nearest line above
 * it is used instead, which keeps the reader within a block or two of where
 * they were rather than throwing them back to the top.
 */
export function restoreAnchor(view: DiffView, anchor: ScrollAnchor): void {
  const root = view.docFor(anchor.side);
  const target = elementForLine(root, anchor.line) ?? elementForLine(view.docFor('new'), anchor.line);
  if (!target) return;

  const scroller = view.scrollerFor(anchor.side);
  scroller.scrollTop = scroller.scrollTop + topWithin(target, scroller) - anchor.offset;
}
