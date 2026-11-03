/**
 * Data shapes exchanged between the service worker and the overlay.
 *
 * Everything here crosses `chrome.runtime.sendMessage`, so it must stay
 * structured-clone friendly: plain objects, no class instances, no functions.
 */

import type { DiffSide } from '@core/types';

export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';

/**
 * What is being diffed.
 *
 * A pull request and a single commit are the same thing to everything that
 * renders: two revisions of one repository. They part company only at
 * comments, where GitHub offers review threads for one and a flat list keyed
 * by diff position for the other — so the kind is carried along rather than
 * inferred from whether `number` happens to be set.
 */
export type DiffTargetKind = 'pull' | 'commit';

export interface DiffTarget {
  kind: DiffTargetKind;
  host: string;
  owner: string;
  repo: string;
  /** Pull request number; null for a commit. */
  number: number | null;
  title: string;
  baseSha: string;
  headSha: string;
  /** Head may live in a fork; raw content has to be fetched from there. */
  headOwner: string;
  headRepo: string;
}

/** Short identity of a target, used for storage keys and for the title. */
export function refOf(target: DiffTarget): string {
  return target.kind === 'pull' ? `pull/${String(target.number)}` : target.headSha;
}

/** What to call each side of the diff, which differs by kind. */
export function sideLabels(target: DiffTarget): { base: string; head: string } {
  const short = (sha: string) => sha.slice(0, 7);
  return target.kind === 'pull'
    ? { base: `Base · ${short(target.baseSha)}`, head: `Head · ${short(target.headSha)}` }
    : {
        // "Base" means the merge base of a pull request; for a commit the left
        // side is simply its parent, and saying so avoids implying otherwise.
        base: target.baseSha ? `Parent · ${short(target.baseSha)}` : 'No parent',
        head: `Commit · ${short(target.headSha)}`,
      };
}

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface CommentAuthor {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface ReviewComment {
  /** GraphQL node id, used for mutations. */
  id: string;
  /** REST id, used for replies and edits. */
  databaseId: number;
  author: CommentAuthor | null;
  bodyMarkdown: string;
  createdAt: string;
  url: string;
  viewerDidAuthor: boolean;
}

export interface ReviewThread {
  id: string;
  path: string;
  /** Null once the thread has gone stale — only `originalLine` remains. */
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  side: DiffSide;
  startSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  diffHunk: string;
  comments: ReviewComment[];
}

export interface FileDiffPayload {
  target: DiffTarget;
  file: ChangedFile;
  baseText: string;
  headText: string;
  /** Resolution bases for relative references, one per side. */
  baseAssetUrl: string;
  headAssetUrl: string;
  baseLinkUrl: string;
  headLinkUrl: string;
  /** False when content came from the cookie fallback and writes are unavailable. */
  authenticated: boolean;
  /**
   * Lines a comment may be anchored to, per side.
   *
   * GitHub rejects a comment on any line outside the pull request's diff, so
   * the overlay has to know this set to offer commenting only where it will
   * actually work.
   */
  commentableLines: { left: number[]; right: number[] };
}

export interface ViewerInfo {
  login: string;
  avatarUrl: string;
  scopes: string[];
}

export interface NewCommentInput {
  path: string;
  side: DiffSide;
  line: number;
  startSide?: DiffSide;
  startLine?: number;
  body: string;
}
