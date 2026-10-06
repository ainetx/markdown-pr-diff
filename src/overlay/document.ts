/**
 * The reading view: one version of the file, rendered as a document.
 *
 * No red, no green, no second column — just the markdown as it will look once
 * merged. Review still happens here: every block a comment can be anchored to
 * is marked in the gutter, so what is available is visible without hovering
 * over the page to find out.
 */

import { DOC_CLASS } from '@core/renderDiff';
import type { Side } from '@core/types';
import type { DiffView } from './view';

export interface DocumentViewOptions {
  /** The rendered document to show. */
  content: HTMLElement;
  /** Which version it is, so comments anchor to the right line numbers. */
  side: Side;
  label: string;
  doc?: Document;
}

export function createDocumentView(options: DocumentViewOptions): DiffView {
  const doc = options.doc ?? document;

  const root = doc.createElement('div');
  root.className = 'mdpd-body mdpd-body-document';

  const scroller = doc.createElement('div');
  scroller.className = 'mdpd-pane';

  // The diff marks stay in the DOM — threads and the commentable gutter are
  // anchored through the same elements — but the stylesheet mutes them here.
  options.content.classList.add(`${DOC_CLASS}`, 'mdpd-plain');
  scroller.appendChild(options.content);

  const label = doc.createElement('div');
  label.className = 'mdpd-pane-label';
  label.textContent = options.label;

  root.append(label, scroller);

  return {
    root,
    scrollerFor: () => scroller,
    docFor: () => options.content,
    sideFor: () => options.side,
    refresh: () => undefined,
    // Nothing is presented as a change here, so there is nothing to step
    // between; the toolbar hides the controls in this layout.
    goToChange: () => undefined,
    destroy: () => root.remove(),
  };
}
