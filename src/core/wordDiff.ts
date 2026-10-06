/**
 * Word-level highlighting inside a changed block.
 *
 * `computeWordDiff` is carried over from markdown-diff-visualiser (MIT, see
 * NOTICE) for plain text. The DOM path that follows is a rewrite.
 *
 * Upstream annotated rendered HTML by diffing escaped strings and then walking
 * the HTML with a hand-rolled tokenizer, matching by character index. Because
 * the rendered HTML is already escaped and the annotated text was escaped a
 * second time, any `&`, `<` or `"` in the content made the index comparison
 * fail, and the function silently fell back to unhighlighted text. Diffing the
 * DOM's own text nodes removes escaping from the picture entirely: offsets are
 * computed over the same characters the browser already parsed.
 */

import DiffMatchPatch from 'diff-match-patch';

export const ADDED_WORD_CLASS = 'diff-added-word';
export const REMOVED_WORD_CLASS = 'diff-removed-word';

/** Beyond this many characters per side the quadratic-ish diff is not worth it. */
const MAX_CHARS = 40_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function newDmp(): DiffMatchPatch {
  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = 0.5;
  return dmp;
}

/**
 * Annotated HTML for two plain-text strings. Retained from upstream for the
 * cases that never touch the DOM (and for tests).
 */
export function computeWordDiff(
  oldText: string,
  newText: string,
): { oldAnnotated: string; newAnnotated: string } {
  if (oldText === newText) {
    return { oldAnnotated: escapeHtml(oldText), newAnnotated: escapeHtml(newText) };
  }

  const dmp = newDmp();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  let oldAnnotated = '';
  let newAnnotated = '';

  for (const [op, text] of diffs) {
    const escaped = escapeHtml(text);
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      oldAnnotated += escaped;
      newAnnotated += escaped;
    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      oldAnnotated += `<span class="${REMOVED_WORD_CLASS}">${escaped}</span>`;
    } else {
      newAnnotated += `<span class="${ADDED_WORD_CLASS}">${escaped}</span>`;
    }
  }

  return { oldAnnotated, newAnnotated };
}

interface TextSlot {
  node: Text;
  /** Offset of this node's first character within the combined stream. */
  start: number;
  /** Exclusive end offset within the combined stream. */
  end: number;
}

interface TextStream {
  text: string;
  slots: TextSlot[];
}

/** Flattens the text nodes of several elements into one addressable stream. */
function readStream(elements: readonly Element[]): TextStream {
  const slots: TextSlot[] = [];
  let text = '';

  for (const el of elements) {
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const value = node.data;
      if (value.length > 0) {
        slots.push({ node, start: text.length, end: text.length + value.length });
        text += value;
      }
      node = walker.nextNode() as Text | null;
    }
  }

  return { text, slots };
}

interface Span {
  start: number;
  end: number;
}

/** Replaces each covered stretch of a text node with a highlight span. */
function applySpans(stream: TextStream, spans: readonly Span[], className: string): void {
  if (spans.length === 0) return;

  for (const slot of stream.slots) {
    const local: Span[] = [];
    for (const span of spans) {
      const start = Math.max(span.start, slot.start);
      const end = Math.min(span.end, slot.end);
      if (start < end) local.push({ start: start - slot.start, end: end - slot.start });
    }
    if (local.length === 0) continue;

    const doc = slot.node.ownerDocument;
    const data = slot.node.data;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;

    for (const span of local) {
      if (span.start > cursor) {
        fragment.appendChild(doc.createTextNode(data.slice(cursor, span.start)));
      }
      const mark = doc.createElement('span');
      mark.className = className;
      mark.textContent = data.slice(span.start, span.end);
      fragment.appendChild(mark);
      cursor = span.end;
    }
    if (cursor < data.length) {
      fragment.appendChild(doc.createTextNode(data.slice(cursor)));
    }

    slot.node.replaceWith(fragment);
  }
}

/**
 * Highlights the differing words between the two sides of a modified block,
 * in place. `oldElements` and `newElements` are the elements classification
 * paired up; each side is treated as one continuous run of text.
 */
export function applyWordDiff(
  oldElements: readonly Element[],
  newElements: readonly Element[],
): boolean {
  if (oldElements.length === 0 || newElements.length === 0) return false;

  const oldStream = readStream(oldElements);
  const newStream = readStream(newElements);

  if (oldStream.text === newStream.text) return false;
  if (oldStream.text.length > MAX_CHARS || newStream.text.length > MAX_CHARS) return false;

  const dmp = newDmp();
  const diffs = dmp.diff_main(oldStream.text, newStream.text);
  dmp.diff_cleanupSemantic(diffs);

  const deletions: Span[] = [];
  const insertions: Span[] = [];
  let oldPos = 0;
  let newPos = 0;

  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      oldPos += text.length;
      newPos += text.length;
    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      deletions.push({ start: oldPos, end: oldPos + text.length });
      oldPos += text.length;
    } else {
      insertions.push({ start: newPos, end: newPos + text.length });
      newPos += text.length;
    }
  }

  // Mutating one side cannot disturb the other: the streams are independent.
  applySpans(oldStream, deletions, REMOVED_WORD_CLASS);
  applySpans(newStream, insertions, ADDED_WORD_CLASS);

  return deletions.length > 0 || insertions.length > 0;
}
