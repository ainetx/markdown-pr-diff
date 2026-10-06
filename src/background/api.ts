/**
 * GitHub REST and GraphQL client.
 *
 * Lives in the service worker so the token never enters a page context, CORS
 * never applies (host permissions cover these origins), and every error and
 * rate-limit response is handled in one place.
 */

import { OAUTH_SCOPES } from '@shared/config';
import type { GitHubHost } from '@shared/githubHost';
import { assetBase, hostFor, linkBase, pullRequestDiffUrl, rawUrl } from '@shared/githubHost';
import type {
  ChangedFile,
  FileDiffPayload,
  FileStatus,
  NewCommentInput,
  PullRequestInfo,
  ReviewThread,
  ViewerInfo,
} from '@shared/github';
import type { DiffSide } from '@core/types';
import {
  commentableLines,
  findFileDiff,
  parseUnifiedDiff,
  reconstructBase,
  type CommentableLines,
} from '@core/diffParser';
import { getToken } from './tokenStore';

export type ApiErrorKind =
  'unauthenticated' | 'forbidden' | 'not-found' | 'invalid' | 'rate-limited' | 'network' | 'server';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status = 0,
    /** Epoch milliseconds when a rate-limited caller may retry. */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function classify(status: number, body: string, headers: Headers): ApiError {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');

  if (status === 401) {
    return new ApiError(
      'unauthenticated',
      'The GitHub token was rejected. Reconnect in the extension options.',
      status,
    );
  }
  if (status === 403 && remaining === '0') {
    const retryAt = reset ? Number(reset) * 1000 : undefined;
    return new ApiError('rate-limited', 'GitHub API rate limit reached.', status, retryAt);
  }
  if (status === 429) {
    const retryAfter = headers.get('retry-after');
    const retryAt = retryAfter ? Date.now() + Number(retryAfter) * 1000 : undefined;
    return new ApiError('rate-limited', 'GitHub asked us to slow down.', status, retryAt);
  }
  if (status === 403) {
    return new ApiError(
      'forbidden',
      'GitHub refused this request. The token may lack the `repo` scope, or the organization may not have approved this OAuth app.',
      status,
    );
  }
  if (status === 404) {
    return new ApiError('not-found', 'Not found, or not visible to this token.', status);
  }
  if (status === 422) {
    return new ApiError('invalid', `GitHub rejected the request: ${body.slice(0, 300)}`, status);
  }
  return new ApiError('server', `GitHub returned ${status}: ${body.slice(0, 300)}`, status);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  /** Proceed without a token; only safe for public, read-only endpoints. */
  allowAnonymous?: boolean;
}

async function rest(
  gh: GitHubHost,
  path: string,
  options: RequestOptions = {},
): Promise<{ response: Response; text: string }> {
  const token = await getToken(gh.host);
  if (!token && !options.allowAnonymous) {
    throw new ApiError('unauthenticated', 'Not connected to GitHub.', 401);
  }

  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${gh.api}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new ApiError('network', `Cannot reach ${gh.api}: ${String(cause)}`);
  }

  const text = await response.text();
  if (!response.ok) throw classify(response.status, text, response.headers);
  return { response, text };
}

async function restJson<T>(gh: GitHubHost, path: string, options?: RequestOptions): Promise<T> {
  const { text } = await rest(gh, path, options);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function graphql<T>(
  gh: GitHubHost,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await getToken(gh.host);
  if (!token) throw new ApiError('unauthenticated', 'Not connected to GitHub.', 401);

  let response: Response;
  try {
    response = await fetch(gh.graphql, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new ApiError('network', `Cannot reach ${gh.graphql}: ${String(cause)}`);
  }

  const text = await response.text();
  if (!response.ok) throw classify(response.status, text, response.headers);

  const payload = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) {
    throw new ApiError('invalid', payload.errors.map((e) => e.message).join('; '), 200);
  }
  if (!payload.data) throw new ApiError('server', 'Empty GraphQL response.', 200);
  return payload.data;
}

// ------------------------------------------------------------------ viewer

export async function getViewer(host: string): Promise<ViewerInfo> {
  const gh = hostFor(host);
  const { response, text } = await rest(gh, '/user');
  const user = JSON.parse(text) as { login: string; avatar_url: string };
  const scopeHeader = response.headers.get('x-oauth-scopes') ?? '';
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
    scopes: scopeHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function missingScopes(viewer: ViewerInfo): string[] {
  // Fine-grained tokens carry no x-oauth-scopes header at all. An empty list
  // means "cannot tell", not "has nothing" — warning about missing scopes
  // there would be a false alarm on a perfectly good token.
  if (viewer.scopes.length === 0) return [];
  // `repo` implies its sub-scopes; a token carrying it satisfies everything we ask for.
  if (viewer.scopes.includes('repo')) return [];
  return OAUTH_SCOPES.split(/[,\s]+/)
    .filter(Boolean)
    .filter((scope) => !viewer.scopes.includes(scope));
}

// ------------------------------------------------------------ pull request

interface RestPullRequest {
  title: string;
  base: { sha: string; repo: { name: string; owner: { login: string } } };
  head: { sha: string; repo: { name: string; owner: { login: string } } | null };
}

export async function getPullRequest(
  host: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestInfo> {
  const gh = hostFor(host);
  const pr = await restJson<RestPullRequest>(gh, `/repos/${owner}/${repo}/pulls/${number}`);
  return {
    host,
    owner,
    repo,
    number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    // A deleted fork leaves head.repo null; the base repo still holds the commit.
    headOwner: pr.head.repo?.owner.login ?? owner,
    headRepo: pr.head.repo?.name ?? repo,
  };
}

interface RestFile {
  filename: string;
  previous_filename?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Absent for files GitHub considers too large to diff. */
  patch?: string;
}

/**
 * Per-file patches, kept from the files listing.
 *
 * They are what tells us which lines a comment can be anchored to, and the
 * listing is fetched anyway — holding on to them avoids a second round trip
 * and keeps them out of the message that crosses to the page.
 */
const patchCacheByFile = new Map<string, Map<string, string>>();

function prKey(host: string, owner: string, repo: string, number: number): string {
  return `${host}/${owner}/${repo}/${number}`;
}

export async function listPullRequestFiles(
  host: string,
  owner: string,
  repo: string,
  number: number,
): Promise<ChangedFile[]> {
  const gh = hostFor(host);
  const files: ChangedFile[] = [];
  const patches = new Map<string, string>();

  for (let page = 1; page <= 30; page++) {
    const batch = await restJson<RestFile[]>(
      gh,
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    for (const file of batch) {
      files.push({
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      });
      // Kept here rather than on ChangedFile: the patches are large and the
      // file list travels to the page on every open.
      if (file.patch) patches.set(file.filename, file.patch);
    }
    if (batch.length < 100) break;
  }

  patchCacheByFile.set(prKey(host, owner, repo, number), patches);
  return files;
}

// ----------------------------------------------------------- file contents

const contentCache = new Map<string, string | null>();

/**
 * Raw file content at a commit. Returns null when the path does not exist
 * there, which is the normal case for the base side of an added file.
 */
export async function getFileContent(
  host: string,
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  const gh = hostFor(host);
  const cacheKey = `${host}/${owner}/${repo}/${sha}/${path}`;
  const cached = contentCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const content = await fetchContent(gh, owner, repo, sha, path);
  contentCache.set(cacheKey, content);
  return content;
}

async function fetchContent(
  gh: GitHubHost,
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  const token = await getToken(gh.host);

  if (token) {
    try {
      const { text } = await rest(
        gh,
        `/repos/${owner}/${repo}/contents/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}?ref=${encodeURIComponent(sha)}`,
        { accept: 'application/vnd.github.raw' },
      );
      return text;
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  // No token: fall back to the raw host using the browser's own session.
  // Enough to view a diff; writing comments still needs a token.
  const response = await fetch(rawUrl(gh, owner, repo, sha, path), { credentials: 'include' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError('server', `Cannot read ${path} at ${sha.slice(0, 7)}.`, response.status);
  }
  return response.text();
}

const patchCache = new Map<string, string | null>();

/** The pull request's unified patch, readable with the browser session alone. */
async function pullRequestPatch(pullRequest: PullRequestInfo): Promise<string | null> {
  const gh = hostFor(pullRequest.host);
  const key = `${pullRequest.host}/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`;
  const cached = patchCache.get(key);
  if (cached !== undefined) return cached;

  let text: string | null = null;
  try {
    const response = await fetch(
      pullRequestDiffUrl(gh, pullRequest.owner, pullRequest.repo, pullRequest.number),
      { credentials: 'include' },
    );
    if (response.ok) text = await response.text();
  } catch {
    text = null;
  }

  patchCache.set(key, text);
  return text;
}

/**
 * Last resort for the base side: rebuild it by undoing the patch against the
 * head version. Needed when the base blob itself is unreadable — a rewritten
 * base branch, say — but the patch and the head blob are both available.
 */
async function reconstructBaseText(
  pullRequest: PullRequestInfo,
  file: ChangedFile,
  headText: string,
): Promise<string | null> {
  const patch = await pullRequestPatch(pullRequest);
  if (!patch) return null;

  const diffs = parseUnifiedDiff(patch);
  const fileDiff =
    findFileDiff(diffs, file.path) ??
    (file.previousPath ? findFileDiff(diffs, file.previousPath) : null);
  if (!fileDiff || fileDiff.binary) return null;

  return reconstructBase(headText, fileDiff.hunks);
}

/**
 * Which lines of this file a comment may be anchored to.
 *
 * Prefers the per-file patch kept from the files listing; falls back to the
 * whole pull request's patch, which also works without a token. An empty
 * result means commenting on this file is not possible, and the overlay says
 * so rather than letting GitHub reject the attempt.
 */
async function resolveCommentableLines(
  pullRequest: PullRequestInfo,
  file: ChangedFile,
): Promise<CommentableLines> {
  const key = prKey(pullRequest.host, pullRequest.owner, pullRequest.repo, pullRequest.number);
  const perFile = patchCacheByFile.get(key)?.get(file.path);

  if (perFile) {
    // A per-file patch has no "diff --git" header; parse-diff needs one.
    const parsed = parseUnifiedDiff(
      `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${perFile}\n`,
    );
    const found = parsed[0];
    if (found) return commentableLines(found.hunks);
  }

  const whole = await pullRequestPatch(pullRequest);
  if (!whole) return { left: [], right: [] };

  const diffs = parseUnifiedDiff(whole);
  const fileDiff =
    findFileDiff(diffs, file.path) ??
    (file.previousPath ? findFileDiff(diffs, file.previousPath) : null);
  return fileDiff ? commentableLines(fileDiff.hunks) : { left: [], right: [] };
}

/** Reads a blob, turning any failure into null so the caller can fall back. */
async function tryGetFileContent(
  host: string,
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  try {
    return await getFileContent(host, owner, repo, sha, path);
  } catch {
    return null;
  }
}

/** Everything the overlay needs to render one file. */
export async function getFileDiff(
  pullRequest: PullRequestInfo,
  file: ChangedFile,
): Promise<FileDiffPayload> {
  const gh = hostFor(pullRequest.host);
  const basePath = file.previousPath ?? file.path;

  const [baseBlob, headText] = await Promise.all([
    file.status === 'added'
      ? Promise.resolve(null)
      : tryGetFileContent(
          pullRequest.host,
          pullRequest.owner,
          pullRequest.repo,
          pullRequest.baseSha,
          basePath,
        ),
    file.status === 'removed'
      ? Promise.resolve(null)
      : getFileContent(
          pullRequest.host,
          pullRequest.headOwner,
          pullRequest.headRepo,
          pullRequest.headSha,
          file.path,
        ),
  ]);

  let baseText = baseBlob;
  if (baseText === null && file.status !== 'added' && headText !== null) {
    baseText = await reconstructBaseText(pullRequest, file, headText);
  }

  return {
    pullRequest,
    file,
    commentableLines: await resolveCommentableLines(pullRequest, file),
    baseText: baseText ?? '',
    headText: headText ?? '',
    baseAssetUrl: assetBase(gh, pullRequest.owner, pullRequest.repo, pullRequest.baseSha, basePath),
    headAssetUrl: assetBase(
      gh,
      pullRequest.headOwner,
      pullRequest.headRepo,
      pullRequest.headSha,
      file.path,
    ),
    baseLinkUrl: linkBase(gh, pullRequest.owner, pullRequest.repo, pullRequest.baseSha, basePath),
    headLinkUrl: linkBase(
      gh,
      pullRequest.headOwner,
      pullRequest.headRepo,
      pullRequest.headSha,
      file.path,
    ),
    authenticated: (await getToken(pullRequest.host)) !== null,
  };
}

// ------------------------------------------------------------- review threads

const THREADS_QUERY = `
query Threads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          path
          line
          startLine
          originalLine
          diffSide
          startDiffSide
          isResolved
          isOutdated
          viewerCanResolve
          viewerCanUnresolve
          comments(first: 50) {
            nodes {
              id
              databaseId
              body
              createdAt
              url
              diffHunk
              viewerDidAuthor
              author { login avatarUrl url }
            }
          }
        }
      }
    }
  }
}`;

interface GqlThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GqlThread[];
      };
    } | null;
  } | null;
}

interface GqlThread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  diffSide: DiffSide;
  startDiffSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: {
    nodes: {
      id: string;
      databaseId: number;
      body: string;
      createdAt: string;
      url: string;
      diffHunk: string;
      viewerDidAuthor: boolean;
      author: { login: string; avatarUrl: string; url: string } | null;
    }[];
  };
}

function toReviewThread(node: GqlThread): ReviewThread {
  return {
    id: node.id,
    path: node.path,
    line: node.line,
    startLine: node.startLine,
    originalLine: node.originalLine,
    side: node.diffSide,
    startSide: node.startDiffSide,
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    viewerCanResolve: node.viewerCanResolve,
    viewerCanUnresolve: node.viewerCanUnresolve,
    diffHunk: node.comments.nodes[0]?.diffHunk ?? '',
    comments: node.comments.nodes.map((comment) => ({
      id: comment.id,
      databaseId: comment.databaseId,
      author: comment.author,
      bodyMarkdown: comment.body,
      createdAt: comment.createdAt,
      url: comment.url,
      viewerDidAuthor: comment.viewerDidAuthor,
    })),
  };
}

/** Threads for one file. GraphQL is the only source that reports resolved state. */
export async function listReviewThreads(
  pullRequest: PullRequestInfo,
  path?: string,
): Promise<ReviewThread[]> {
  const gh = hostFor(pullRequest.host);
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 20; page++) {
    const data: GqlThreadsResponse = await graphql<GqlThreadsResponse>(gh, THREADS_QUERY, {
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      number: pullRequest.number,
      cursor,
    });

    const connection = data.repository?.pullRequest?.reviewThreads;
    if (!connection) break;

    for (const node of connection.nodes) {
      if (path !== undefined && node.path !== path) continue;
      threads.push(toReviewThread(node));
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return threads;
}

// ------------------------------------------------------------ comment writes

interface RestComment {
  id: number;
  node_id: string;
  body: string;
  created_at: string;
  html_url: string;
  user: { login: string; avatar_url: string; html_url: string } | null;
}

/** Posts a standalone review comment, the same as GitHub's "Add single comment". */
export async function createReviewComment(
  pullRequest: PullRequestInfo,
  input: NewCommentInput,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  const body: Record<string, unknown> = {
    body: input.body,
    commit_id: pullRequest.headSha,
    path: input.path,
    side: input.side,
    line: input.line,
  };
  if (input.startLine !== undefined && input.startLine !== input.line) {
    body.start_line = input.startLine;
    body.start_side = input.startSide ?? input.side;
  }

  await restJson<RestComment>(
    gh,
    `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}/comments`,
    { method: 'POST', body },
  );
}

export async function replyToComment(
  pullRequest: PullRequestInfo,
  inReplyToDatabaseId: number,
  body: string,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  await restJson<RestComment>(
    gh,
    `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}/comments/${inReplyToDatabaseId}/replies`,
    { method: 'POST', body: { body } },
  );
}

export async function updateComment(
  pullRequest: PullRequestInfo,
  databaseId: number,
  body: string,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  await restJson<RestComment>(
    gh,
    `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/comments/${databaseId}`,
    { method: 'PATCH', body: { body } },
  );
}

export async function deleteComment(
  pullRequest: PullRequestInfo,
  databaseId: number,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  await rest(gh, `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/comments/${databaseId}`, {
    method: 'DELETE',
  });
}

export async function addReaction(
  pullRequest: PullRequestInfo,
  databaseId: number,
  content: string,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  await restJson(
    gh,
    `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/comments/${databaseId}/reactions`,
    { method: 'POST', body: { content } },
  );
}

const RESOLVE_MUTATION = `
mutation Resolve($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

const UNRESOLVE_MUTATION = `
mutation Unresolve($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

export async function setThreadResolved(
  pullRequest: PullRequestInfo,
  threadId: string,
  resolved: boolean,
): Promise<void> {
  const gh = hostFor(pullRequest.host);
  await graphql(gh, resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { threadId });
}
