/**
 * Turns two whole documents into a list of changed line regions.
 *
 * This replaces the upstream pipeline of `parseDiff` -> `reconstructContent` ->
 * `computeBlockDiffs`. Because we always hold both complete versions of the
 * file, a direct line diff gives full context over the whole document, so there
 * is nothing to reconstruct and no truncated hunk context to work around.
 */

import { diffLines } from 'diff';
import type { ChangeRegion, DocumentDiff, LineRange } from './types';

/**
 * Lines in a chunk of text, counted the way the diff counts them.
 *
 * Not `split('\n').length`: an empty document has no lines at all, and a
 * final newline terminates the last line rather than starting another. Using
 * the naive count produces an off-by-one that silently skews pane alignment,
 * so every caller takes the counts from the diff instead of recomputing them.
 */
export function countLines(value: string): number {
  if (value === '') return 0;
  const withoutTrailing = value.endsWith('\n') ? value.slice(0, -1) : value;
  return withoutTrailing.split('\n').length;
}

function range(start: number, count: number): LineRange | null {
  if (count <= 0) return null;
  return { start, end: start + count - 1 };
}

export function computeDocumentDiff(oldText: string, newText: string): DocumentDiff {
  const oldLineCount = countLines(oldText);
  const newLineCount = countLines(newText);

  if (oldText === newText) {
    return { regions: [], unchanged: true, oldLineCount, newLineCount };
  }

  const parts = diffLines(oldText, newText);
  const regions: ChangeRegion[] = [];

  let oldLine = 1;
  let newLine = 1;
  let pairId = 0;
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;
    const count = part.count ?? countLines(part.value);

    if (!part.added && !part.removed) {
      oldLine += count;
      newLine += count;
      i += 1;
      continue;
    }

    if (part.removed) {
      const removedStart = oldLine;
      const removedRange = range(oldLine, count);
      oldLine += count;
      i += 1;

      // A deletion immediately followed by an insertion is a modification:
      // the two sides correspond, which is what enables word-level diffing.
      const next = parts[i];
      const addedStart = newLine;
      if (next?.added) {
        const addedCount = next.count ?? countLines(next.value);
        const addedRange = range(newLine, addedCount);
        newLine += addedCount;
        i += 1;
        regions.push({
          kind: 'modified',
          old: removedRange,
          new: addedRange,
          oldAt: removedStart,
          newAt: addedStart,
          pairId: pairId++,
        });
      } else {
        regions.push({
          kind: 'removed',
          old: removedRange,
          new: null,
          oldAt: removedStart,
          newAt: newLine,
          pairId: pairId++,
        });
      }
      continue;
    }

    // Pure insertion (not preceded by a deletion).
    const addedStartOnly = newLine;
    const addedRange = range(newLine, count);
    newLine += count;
    i += 1;
    regions.push({
      kind: 'added',
      old: null,
      new: addedRange,
      oldAt: oldLine,
      newAt: addedStartOnly,
      pairId: pairId++,
    });
  }

  return { regions, unchanged: regions.length === 0, oldLineCount, newLineCount };
}
