/**
 * Unified-diff parsing and base-version reconstruction.
 *
 * Carried over from markdown-diff-visualiser's src/diffParser.ts (MIT, see
 * NOTICE), narrowed to what the fallback path needs. The main path never comes
 * here: when both blobs are readable the diff is computed directly from them,
 * with full context. This is for the case where the base blob cannot be read
 * but the head blob and the pull request's patch can — the base version is
 * then rebuilt by undoing the patch.
 */

import parseDiffLib from 'parse-diff';

export interface DiffChange {
  type: 'add' | 'del' | 'normal';
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  binary: boolean;
}

function isBinaryDiff(raw: string): boolean {
  return /Binary files .* differ/.test(raw) || /GIT binary patch/.test(raw);
}

/** parse-diff keeps the +/-/space marker in `content`. */
function stripPrefix(content: string): string {
  const first = content[0];
  return first === '+' || first === '-' || first === ' ' ? content.slice(1) : content;
}

function cleanPath(path: string | undefined): string {
  if (!path || path === '/dev/null') return '';
  return path.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(raw: string): ParsedFileDiff[] {
  if (!raw || raw.trim() === '') return [];

  try {
    return parseDiffLib(raw).map((file) => ({
      oldPath: cleanPath(file.from),
      newPath: cleanPath(file.to),
      binary: isBinaryDiff(raw),
      hunks: file.chunks.map((chunk) => ({
        oldStart: chunk.oldStart,
        oldLines: chunk.oldLines,
        newStart: chunk.newStart,
        newLines: chunk.newLines,
        changes: chunk.changes.map((change) => ({
          type: change.type,
          content: stripPrefix(change.content),
        })),
      })),
    }));
  } catch {
    // A malformed patch is a reason to fall back further, not to throw.
    return [];
  }
}

/** The file diff for `path`, matching either the new or the old name. */
export function findFileDiff(diffs: ParsedFileDiff[], path: string): ParsedFileDiff | null {
  return diffs.find((diff) => diff.newPath === path || diff.oldPath === path) ?? null;
}

export interface CommentableLines {
  /** Base-side lines, as GitHub's LEFT. */
  left: number[];
  /** Head-side lines, as GitHub's RIGHT. */
  right: number[];
}

/**
 * The lines a review comment can actually be anchored to.
 *
 * GitHub only accepts a comment on a line that appears in the pull request's
 * diff — inside a hunk, as an addition, a deletion, or one of the few context
 * lines around them. Anchoring anywhere else is rejected with
 * "pull_request_review_thread.line: could not be resolved", so the set has to
 * be known before a comment is offered, not after it fails.
 */
export function commentableLines(hunks: readonly DiffHunk[]): CommentableLines {
  const left: number[] = [];
  const right: number[] = [];

  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const change of hunk.changes) {
      if (change.type === 'normal') {
        left.push(oldLine++);
        right.push(newLine++);
      } else if (change.type === 'del') {
        left.push(oldLine++);
      } else {
        right.push(newLine++);
      }
    }
  }

  return { left, right };
}

/**
 * Rebuilds the base version of a file from its head version and the hunks
 * describing how one became the other.
 */
export function reconstructBase(headText: string, hunks: readonly DiffHunk[]): string {
  if (hunks.length === 0) return headText;

  const newLines = headText.split('\n');
  const oldLines: string[] = [];
  let newIndex = 0;

  for (const hunk of [...hunks].sort((a, b) => a.newStart - b.newStart)) {
    const hunkStart = hunk.newStart - 1;

    // Lines before the hunk are identical in both versions.
    while (newIndex < hunkStart && newIndex < newLines.length) {
      oldLines.push(newLines[newIndex]!);
      newIndex += 1;
    }

    for (const change of hunk.changes) {
      if (change.type === 'normal') {
        oldLines.push(change.content);
        newIndex += 1;
      } else if (change.type === 'del') {
        // Present in the base only.
        oldLines.push(change.content);
      } else {
        // Present in the head only.
        newIndex += 1;
      }
    }
  }

  while (newIndex < newLines.length) {
    oldLines.push(newLines[newIndex]!);
    newIndex += 1;
  }

  return oldLines.join('\n');
}
