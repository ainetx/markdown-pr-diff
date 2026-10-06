/**
 * Shared vocabulary for the diff engine.
 *
 * Line numbers are 1-based and inclusive on both ends, matching how GitHub
 * addresses lines in review comments. `old` refers to the base version of the
 * file (GitHub's LEFT side), `new` to the head version (RIGHT).
 */

export type Side = 'old' | 'new';

/** GitHub's name for the same concept, used at the API boundary. */
export type DiffSide = 'LEFT' | 'RIGHT';

export const sideToDiffSide = (side: Side): DiffSide => (side === 'old' ? 'LEFT' : 'RIGHT');
export const diffSideToSide = (side: DiffSide): Side => (side === 'LEFT' ? 'old' : 'new');

export interface LineRange {
  /** First line, 1-based inclusive. */
  start: number;
  /** Last line, 1-based inclusive. `end < start` means an empty range. */
  end: number;
}

export type RegionKind = 'added' | 'removed' | 'modified';

/**
 * A contiguous run of changed lines.
 *
 * `modified` regions carry both an old and a new range — they are a deletion
 * immediately followed by an insertion, which is what makes word-level diffing
 * meaningful. `added` has no old range, `removed` has no new range.
 */
export interface ChangeRegion {
  kind: RegionKind;
  old: LineRange | null;
  new: LineRange | null;
  /**
   * Where this region sits on the old side, even when it consumes no old
   * lines. For a pure insertion that is the old line the new content was
   * inserted before — information `old: null` alone cannot carry, and without
   * which the two versions cannot be lined up after an insertion.
   */
  oldAt: number;
  /** The same for the new side, for a pure deletion. */
  newAt: number;
  /** Links the two sides of a `modified` region; unique per region. */
  pairId: number;
}

export interface DocumentDiff {
  regions: ChangeRegion[];
  /** True when the two documents are byte-identical. */
  unchanged: boolean;
  /** Line counts as the diff counts them — see `countLines`. */
  oldLineCount: number;
  newLineCount: number;
}
