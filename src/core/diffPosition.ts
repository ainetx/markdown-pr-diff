/**
 * Diff positions, the coordinate system commit comments use.
 *
 * A review comment on a pull request is addressed by `(path, side, line)` —
 * a place in a file. A comment on a commit is addressed by `(path, position)`,
 * where position counts lines down the patch itself: the line just below the
 * file's first `@@` header is 1, and the count keeps going through blank lines
 * and through every later `@@` header until the next file starts.
 *
 * So the same comment has two different addresses depending on what it hangs
 * off, and this module is the translation. Both directions are needed: one to
 * post where the reader clicked, the other to put a comment that came back
 * from the API next to the line a reader is actually looking at.
 */

import type { DiffSide } from './types';

export interface PositionMap {
  /** (side, line) -> position in the patch. */
  positionOf: Map<string, number>;
  /** position -> (side, line), for placing comments that come back. */
  anchorOf: Map<number, { side: DiffSide; line: number }>;
}

function key(side: DiffSide, line: number): string {
  return `${side}:${line}`;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Walks one file's patch and records both directions.
 *
 * The patch is the `patch` field of a file in the commits or pulls API: hunk
 * headers and their lines, with no `diff --git` preamble.
 */
export function buildPositionMap(patch: string): PositionMap {
  const positionOf = new Map<string, number>();
  const anchorOf = new Map<number, { side: DiffSide; line: number }>();

  let position = 0;
  let started = false;
  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split('\n');
  // A trailing newline is a terminator, not an empty context line. Counting it
  // as one would shift every position after it by one.
  if (lines[lines.length - 1] === '') lines.pop();

  for (const raw of lines) {
    const hunk = HUNK.exec(raw);

    if (hunk) {
      // The first header is position 0 — counting starts on the line below it.
      // Every later header is itself a position, because the count runs
      // straight through them.
      if (started) position += 1;
      started = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (!started) continue;
    position += 1;

    if (raw.startsWith('-')) {
      positionOf.set(key('LEFT', oldLine), position);
      anchorOf.set(position, { side: 'LEFT', line: oldLine });
      oldLine += 1;
    } else if (raw.startsWith('+')) {
      positionOf.set(key('RIGHT', newLine), position);
      anchorOf.set(position, { side: 'RIGHT', line: newLine });
      newLine += 1;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" belongs to the line before it and
      // advances neither side.
    } else {
      // A context line exists on both sides; a comment on it is addressed by
      // the same single position either way.
      positionOf.set(key('LEFT', oldLine), position);
      positionOf.set(key('RIGHT', newLine), position);
      anchorOf.set(position, { side: 'RIGHT', line: newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { positionOf, anchorOf };
}

export function positionFor(map: PositionMap, side: DiffSide, line: number): number | null {
  return map.positionOf.get(key(side, line)) ?? null;
}

export function anchorFor(
  map: PositionMap,
  position: number,
): { side: DiffSide; line: number } | null {
  return map.anchorOf.get(position) ?? null;
}
