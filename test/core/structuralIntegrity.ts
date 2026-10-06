/**
 * Shared invariant: rendering a document as one side of a diff must produce
 * exactly the DOM that rendering it on its own produces, apart from the marks
 * the diff adds. This is what upstream's per-block rendering could not hold —
 * a change inside a table or a list came out as a different document.
 */

import { renderDiff } from '@core/renderDiff';
import { ADDED_CLASS, KIND_ATTR, PAIR_ATTR, REMOVED_CLASS } from '@core/classify';
import { ADDED_WORD_CLASS, REMOVED_WORD_CLASS } from '@core/wordDiff';

/** Removes every mark the diff layer adds, leaving the plain rendered document. */
export function stripDiffMarks(pane: HTMLElement): string {
  const clone = pane.cloneNode(true) as HTMLElement;

  for (const el of clone.querySelectorAll(`.${ADDED_WORD_CLASS}, .${REMOVED_WORD_CLASS}`)) {
    el.replaceWith(...el.childNodes);
  }
  clone.normalize();

  for (const el of clone.querySelectorAll(`.${ADDED_CLASS}, .${REMOVED_CLASS}`)) {
    el.classList.remove(ADDED_CLASS, REMOVED_CLASS);
    if (el.classList.length === 0) el.removeAttribute('class');
    el.removeAttribute(PAIR_ATTR);
    el.removeAttribute(KIND_ATTR);
  }

  return clone.innerHTML;
}

/** The document rendered on its own, with no diff applied. */
export function renderStandalone(text: string): string {
  return renderDiff({ oldText: text, newText: text }).newPane.innerHTML;
}

export function panesOf(before: string, after: string) {
  const result = renderDiff({ oldText: before, newText: after });
  return { before: result.oldPane, after: result.newPane, result };
}
