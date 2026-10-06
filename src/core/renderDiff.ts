/**
 * Renders a rendered-markdown diff for one file.
 *
 * This is the entry point that replaces upstream's `highlightDiff`. The shape
 * of the result is the same idea — an old side and a new side, carrying the
 * `diff-added-block` / `diff-removed-block` CSS contract — but each side is a
 * live DOM tree rendered from the complete document rather than a string
 * stitched together from separately rendered fragments.
 */

import { buildAnchorIndex, type AnchorIndex } from './anchor';
import { computeDocumentDiff } from './blockDiff';
import { classify } from './classify';
import { createRenderer, type MarkdownRenderer } from './markdownRenderer';
import { resolveRelativeUrls, type UrlBases } from './resolveUrls';
import { toSafeFragment } from './sanitize';
import type { DocumentDiff, Side } from './types';
import { applyWordDiff } from './wordDiff';

export const DOC_CLASS = 'md-diff-doc';

export interface RenderDiffOptions {
  oldText: string;
  newText: string;
  /** Resolution bases for the base version — raw assets and in-repo links. */
  oldBases?: UrlBases;
  /** Resolution bases for the head version. */
  newBases?: UrlBases;
  doc?: Document;
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

export interface RenderedDiff {
  oldPane: HTMLElement;
  newPane: HTMLElement;
  diff: DocumentDiff;
  anchors: Record<Side, AnchorIndex>;
  stats: DiffStats;
}

let shared: MarkdownRenderer | null = null;
function renderer(): MarkdownRenderer {
  shared ??= createRenderer();
  return shared;
}

function buildPane(markdown: string, bases: UrlBases | undefined, doc: Document): HTMLElement {
  const container = doc.createElement('div');
  container.className = DOC_CLASS;
  if (markdown) {
    container.appendChild(toSafeFragment(renderer().render(markdown), doc));
    if (bases) resolveRelativeUrls(container, bases);
  }
  return container;
}

export function renderDiff(options: RenderDiffOptions): RenderedDiff {
  const doc = options.doc ?? document;
  const diff = computeDocumentDiff(options.oldText, options.newText);

  const oldPane = buildPane(options.oldText, options.oldBases, doc);
  const newPane = buildPane(options.newText, options.newBases, doc);

  const oldMarks = classify(oldPane, diff.regions, 'old');
  const newMarks = classify(newPane, diff.regions, 'new');

  // Word-level highlighting only applies where both sides of a modification
  // produced marked elements; everything else stays block-level.
  for (const [pairId, oldElements] of oldMarks.pairs) {
    const newElements = newMarks.pairs.get(pairId);
    if (newElements) applyWordDiff(oldElements, newElements);
  }

  const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
  for (const region of diff.regions) stats[region.kind] += 1;

  return {
    oldPane,
    newPane,
    diff,
    anchors: { old: buildAnchorIndex(oldPane), new: buildAnchorIndex(newPane) },
    stats,
  };
}
