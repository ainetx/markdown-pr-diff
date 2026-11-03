import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorFor, buildPositionMap, positionFor } from '../../src/core/diffPosition';

/**
 * The oracles are real commit comments on facebook/react, fetched from the
 * API with both their `position` and the file `line` GitHub itself resolved it
 * to. Getting this off by one would not fail loudly — it would quietly attach
 * every comment to its neighbour — so the arithmetic is pinned against
 * GitHub's own answer rather than against my reading of the documentation.
 */
function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'test', 'fixtures', 'patches', name), 'utf8');
}

const ORACLES = [
  { file: 'react-text-component.patch', position: 13, line: 61 },
  { file: 'react-npm-task.patch', position: 19, line: 26 },
  { file: 'react-jsx-is-not-html.patch', position: 48, line: 58 },
];

describe('buildPositionMap', () => {
  for (const oracle of ORACLES) {
    it(`agrees with GitHub on ${oracle.file}`, () => {
      const map = buildPositionMap(fixture(oracle.file));
      const anchor = anchorFor(map, oracle.position);

      expect(anchor).not.toBeNull();
      expect(anchor!.line).toBe(oracle.line);
      // Round trip: the line GitHub reported must address the same position.
      expect(positionFor(map, anchor!.side, anchor!.line)).toBe(oracle.position);
    });
  }

  it('starts counting below the first hunk header', () => {
    const map = buildPositionMap('@@ -1,2 +1,3 @@\n a\n+b\n c\n');

    expect(positionFor(map, 'RIGHT', 1)).toBe(1);
    expect(positionFor(map, 'RIGHT', 2)).toBe(2);
    expect(positionFor(map, 'RIGHT', 3)).toBe(3);
  });

  it('counts a later hunk header as a position of its own', () => {
    // Without that, everything after the second hunk is one short — the
    // failure mode that puts a comment on the preceding line.
    const map = buildPositionMap('@@ -1,1 +1,1 @@\n a\n@@ -10,1 +10,1 @@\n+x\n');

    expect(positionFor(map, 'RIGHT', 1)).toBe(1);
    expect(positionFor(map, 'RIGHT', 10)).toBe(3);
  });

  it('does not invent a position for a trailing newline', () => {
    const withNewline = buildPositionMap('@@ -1,1 +1,1 @@\n a\n');
    const without = buildPositionMap('@@ -1,1 +1,1 @@\n a');

    expect(withNewline.anchorOf.size).toBe(1);
    expect(withNewline.anchorOf.size).toBe(without.anchorOf.size);
  });

  it('leaves a removed line addressable only on the left', () => {
    const map = buildPositionMap('@@ -1,2 +1,1 @@\n a\n-gone\n');

    expect(positionFor(map, 'LEFT', 2)).toBe(2);
    expect(positionFor(map, 'RIGHT', 2)).toBeNull();
  });

  it('ignores the no-newline marker', () => {
    const map = buildPositionMap('@@ -1,1 +1,2 @@\n a\n+b\n\\ No newline at end of file');

    expect(positionFor(map, 'RIGHT', 2)).toBe(2);
    expect(anchorFor(map, 3)).toBeNull();
  });
});
