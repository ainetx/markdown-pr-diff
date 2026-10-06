/**
 * Correspondence between base and head line numbers.
 *
 * Every line outside a change region exists in both versions, just at
 * different offsets. Walking the regions once yields the shift that applies to
 * each unchanged stretch, which is what lets the two rendered panes be lined up
 * against each other precisely.
 */

import type { ChangeRegion } from './types';

interface Span {
  oldStart: number;
  oldEnd: number;
  /** newLine = oldLine + delta, for lines inside this span. */
  delta: number;
}

export interface LineMapping {
  /** The head line matching `oldLine`, or null if that line was changed. */
  toNew(oldLine: number): number | null;
}

export function buildLineMapping(
  regions: readonly ChangeRegion[],
  oldLineCount: number,
): LineMapping {
  const spans: Span[] = [];
  let oldCursor = 1;
  let newCursor = 1;

  const ordered = [...regions].sort((a, b) => a.oldAt - b.oldAt);

  for (const region of ordered) {
    // Lines between the previous region and this one exist in both versions,
    // shifted by however much the earlier regions added or removed.
    if (region.oldAt > oldCursor) {
      spans.push({
        oldStart: oldCursor,
        oldEnd: region.oldAt - 1,
        delta: newCursor - oldCursor,
      });
    }

    oldCursor = region.old ? region.old.end + 1 : region.oldAt;
    newCursor = region.new ? region.new.end + 1 : region.newAt;
  }

  if (oldCursor <= oldLineCount) {
    spans.push({ oldStart: oldCursor, oldEnd: oldLineCount, delta: newCursor - oldCursor });
  }

  return {
    toNew(oldLine: number): number | null {
      // Few spans in practice; a linear scan beats the bookkeeping of a search.
      for (const span of spans) {
        if (oldLine >= span.oldStart && oldLine <= span.oldEnd) return oldLine + span.delta;
      }
      return null;
    },
  };
}
