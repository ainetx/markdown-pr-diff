/**
 * Data shapes exchanged between the service worker and the overlay.
 *
 * Everything here crosses `chrome.runtime.sendMessage`, so it must stay
 * structured-clone friendly: plain objects, no class instances, no functions.
 */

import type { DiffSide } from '@core/types';

export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';

export interface PullRequestInfo {
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  baseSha: string;
  headSha: string;
  /** Head may live in a fork; raw content has to be fetched from there. */
  headOwner: string;
  headRepo: string;
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
  pullRequest: PullRequestInfo;
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
