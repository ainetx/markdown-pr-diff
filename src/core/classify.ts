/**
 * Marks rendered elements that fall inside changed line regions.
 *
 * This is the replacement for upstream's `computeBlockDiffs` + per-block
 * `render()`. Upstream sliced the markdown into blocks of changed lines and
 * rendered each slice on its own, which produced broken HTML whenever a change
 * sat inside a table, a list or a fenced block. Here the document is rendered
 * once, intact, and classification happens afterwards over the real DOM.
 *
 * Only the *deepest* intersecting elements are marked, so a one-row change in a
 * table highlights that `<tr>` rather than the entire `<table>`.
 */

import { readLineRange } from './lineMap';
import type { ChangeRegion, LineRange, Side } from './types';

export const ADDED_CLASS = 'diff-added-block';
export const REMOVED_CLASS = 'diff-removed-block';
export const PAIR_ATTR = 'data-md-diff-pair';
export const KIND_ATTR = 'data-md-diff-kind';

export interface ClassifyResult {
  /** Elements marked on this side, in document order. */
  changed: Element[];
  /** pairId -> marked elements, for word-level diffing of modified regions. */
  pairs: Map<number, Element[]>;
}

interface Candidate {
  el: Element;
  range: LineRange;
}

function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function rangeFor(region: ChangeRegion, side: Side): LineRange | null {
  return side === 'old' ? region.old : region.new;
}

export function classify(root: ParentNode, regions: ChangeRegion[], side: Side): ClassifyResult {
  const applicable = regions
    .map((region) => ({ region, range: rangeFor(region, side) }))
    .filter((entry): entry is { region: ChangeRegion; range: LineRange } => entry.range !== null);

  const result: ClassifyResult = { changed: [], pairs: new Map() };
  if (applicable.length === 0) return result;

  const candidates: Candidate[] = [];
  for (const el of root.querySelectorAll('[data-line-start]')) {
    const range = readLineRange(el);
    if (range) candidates.push({ el, range });
  }

  const hits = new Map<Element, { region: ChangeRegion; range: LineRange }[]>();
  for (const candidate of candidates) {
    const matched = applicable.filter((entry) => overlaps(entry.range, candidate.range));
    if (matched.length > 0) hits.set(candidate.el, matched);
  }

  const markedClass = side === 'old' ? REMOVED_CLASS : ADDED_CLASS;

  for (const [el, matched] of hits) {
    // Skip ancestors of other hits: the deepest element wins.
    const hasDeeperHit = [...hits.keys()].some((other) => other !== el && el.contains(other));
    if (hasDeeperHit) continue;

    el.classList.add(markedClass);
    result.changed.push(el);

    const kinds = new Set(matched.map((entry) => entry.region.kind));
    el.setAttribute(KIND_ATTR, [...kinds].join(' '));

    // Word-level diffing only makes sense when exactly one modified region
    // claims this element — otherwise there is no single counterpart to
    // compare it against.
    const modified = matched.filter((entry) => entry.region.kind === 'modified');
    if (modified.length === 1) {
      const pairId = modified[0]!.region.pairId;
      el.setAttribute(PAIR_ATTR, String(pairId));
      const bucket = result.pairs.get(pairId);
      if (bucket) bucket.push(el);
      else result.pairs.set(pairId, [el]);
    }
  }

  // querySelectorAll order is document order, but the Map iteration above
  // follows insertion order of `hits`, which is the same. Keep it explicit.
  result.changed.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  return result;
}
