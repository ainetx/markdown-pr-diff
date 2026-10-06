/**
 * Maps between source line numbers and rendered elements.
 *
 * GitHub addresses a review comment by (path, side, line). The line map that
 * classification already relies on is exactly what is needed to place an
 * existing thread next to the paragraph it talks about, and to pick the line
 * for a new comment started from the rendered view.
 */

import { readLineRange } from './lineMap';
import type { LineRange } from './types';

interface Entry {
  el: Element;
  range: LineRange;
  /** Depth in the tree; deeper entries are more specific. */
  depth: number;
}

export interface AnchorIndex {
  /**
   * The most specific element covering `line`. When no element covers it — a
   * blank line between blocks, say — falls back to the nearest element that
   * ends before it, so a thread still lands in a sensible place.
   */
  elementForLine(line: number): Element | null;
  /** The source range an element covers, if it carries one. */
  rangeForElement(el: Element): LineRange | null;
  /** True when nothing in this render carries line information. */
  isEmpty(): boolean;
}

function depthOf(el: Element, root: ParentNode): number {
  let depth = 0;
  let node: Node | null = el.parentNode;
  while (node && node !== root) {
    depth += 1;
    node = node.parentNode;
  }
  return depth;
}

export function buildAnchorIndex(root: ParentNode): AnchorIndex {
  const entries: Entry[] = [];
  for (const el of root.querySelectorAll('[data-line-start]')) {
    const range = readLineRange(el);
    if (range) entries.push({ el, range, depth: depthOf(el, root) });
  }

  // Deepest first, so the first covering entry found is the most specific.
  const byDepth = [...entries].sort((a, b) => b.depth - a.depth);
  // For the fallback, scan from the end of the document backwards.
  const byEnd = [...entries].sort((a, b) => a.range.end - b.range.end);

  return {
    elementForLine(line: number): Element | null {
      for (const entry of byDepth) {
        if (line >= entry.range.start && line <= entry.range.end) return entry.el;
      }
      let fallback: Element | null = null;
      for (const entry of byEnd) {
        if (entry.range.end <= line) fallback = entry.el;
        else break;
      }
      return fallback ?? byEnd[0]?.el ?? null;
    },

    rangeForElement(el: Element): LineRange | null {
      return readLineRange(el);
    },

    isEmpty(): boolean {
      return entries.length === 0;
    },
  };
}
