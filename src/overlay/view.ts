/**
 * What the two layouts have in common, so the comment layer does not need to
 * know which one is on screen.
 */

import type { Side } from '@core/types';

export interface DiffView {
  root: HTMLElement;
  /** Scroll container for a side; both sides share one in the unified layout. */
  scrollerFor(side: Side): HTMLElement;
  /** The rendered document for a side — where thread cards get inserted. */
  docFor(side: Side): HTMLElement;
  refresh(): void;
  goToChange(direction: 1 | -1): void;
  destroy(): void;
}

export type WholeFileKind = 'added' | 'removed' | null;

/**
 * Whether a file has no counterpart to compare against.
 *
 * A file that was added or deleted has nothing on the other side. Showing an
 * empty pane beside a wall of uniform green says nothing useful; the document
 * itself, rendered plainly, is what a reviewer actually wants to read.
 */
export function wholeFileKind(baseText: string, headText: string): WholeFileKind {
  if (baseText === '' && headText !== '') return 'added';
  if (headText === '' && baseText !== '') return 'removed';
  return null;
}
