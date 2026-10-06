import { describe, expect, it } from 'vitest';
import { findFileDiff, parseUnifiedDiff, reconstructBase } from '@core/diffParser';
import { computeDocumentDiff } from '@core/blockDiff';

const PATCH = `diff --git a/docs/guide.md b/docs/guide.md
index 1111111..2222222 100644
--- a/docs/guide.md
+++ b/docs/guide.md
@@ -1,5 +1,6 @@
 # Guide
 
-Old sentence.
+New sentence.
+Added sentence.
 
 Tail.
`;

const HEAD = ['# Guide', '', 'New sentence.', 'Added sentence.', '', 'Tail.', ''].join('\n');
const BASE = ['# Guide', '', 'Old sentence.', '', 'Tail.', ''].join('\n');

describe('parseUnifiedDiff', () => {
  it('reads paths and hunks out of a patch', () => {
    const diffs = parseUnifiedDiff(PATCH);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.oldPath).toBe('docs/guide.md');
    expect(diffs[0]!.newPath).toBe('docs/guide.md');
    expect(diffs[0]!.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
  });

  it('strips the +/-/space markers from line content', () => {
    const changes = parseUnifiedDiff(PATCH)[0]!.hunks[0]!.changes;
    expect(changes.find((c) => c.type === 'del')!.content).toBe('Old sentence.');
    expect(changes.find((c) => c.type === 'add')!.content).toBe('New sentence.');
  });

  it('flags a binary patch instead of pretending to parse it', () => {
    const binary = 'diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n';
    expect(parseUnifiedDiff(binary)[0]?.binary).toBe(true);
  });

  it('returns nothing for empty or malformed input rather than throwing', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('not a diff at all')).toEqual([]);
  });

  it('finds a file by either of its names', () => {
    const renamed = parseUnifiedDiff(
      'diff --git a/old.md b/new.md\n--- a/old.md\n+++ b/new.md\n@@ -1 +1 @@\n-a\n+b\n',
    );
    expect(findFileDiff(renamed, 'new.md')).not.toBeNull();
    expect(findFileDiff(renamed, 'old.md')).not.toBeNull();
    expect(findFileDiff(renamed, 'other.md')).toBeNull();
  });
});

describe('reconstructBase', () => {
  it('rebuilds the base version from the head version and the patch', () => {
    const hunks = parseUnifiedDiff(PATCH)[0]!.hunks;
    expect(reconstructBase(HEAD, hunks)).toBe(BASE);
  });

  it('produces a base that diffs back to the same change', () => {
    const hunks = parseUnifiedDiff(PATCH)[0]!.hunks;
    const rebuilt = reconstructBase(HEAD, hunks);
    const direct = computeDocumentDiff(BASE, HEAD);
    const viaRebuild = computeDocumentDiff(rebuilt, HEAD);
    expect(viaRebuild.regions).toEqual(direct.regions);
  });

  it('returns the head unchanged when there are no hunks', () => {
    expect(reconstructBase(HEAD, [])).toBe(HEAD);
  });
});
