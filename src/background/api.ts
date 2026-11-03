/**
 * GitHub REST and GraphQL client.
 *
 * Lives in the service worker so the token never enters a page context, CORS
 * never applies (host permissions cover these origins), and every error and
 * rate-limit response is handled in one place.
 */

import { OAUTH_SCOPES } from '@shared/config';
import type { GitHubHost } from '@shared/githubHost';
import {
  assetBase,
  commitDiffUrl,
  hostFor,
  linkBase,
  pullRequestDiffUrl,
  rawUrl,
} from '@shared/githubHost';
import type {
  ChangedFile,
  FileDiffPayload,
  FileStatus,
  NewCommentInput,
  DiffTarget,
  DiffTargetKind,
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
import { anchorFor, buildPositionMap, positionFor, type PositionMap } from '@core/diffPosition';
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
): Promise<DiffTarget> {
  const gh = hostFor(host);
  const pr = await restJson<RestPullRequest>(gh, `/repos/${owner}/${repo}/pulls/${number}`);
  return {
    kind: 'pull',
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

/**
 * Identity of what is being diffed.
 *
 * A pull request is keyed by its number and a commit by its sha, and the kind
 * is in the key so the two can never collide on a repository whose pull
 * request number happens to look like anything else.
 */
function cacheKey(
  host: string,
  owner: string,
  repo: string,
  kind: DiffTargetKind,
  id: string | number | null,
): string {
  return `${host}/${owner}/${repo}/${kind}/${String(id)}`;
}

function targetKey(target: DiffTarget): string {
  return cacheKey(
    target.host,
    target.owner,
    target.repo,
    target.kind,
    target.kind === 'pull' ? target.number : target.headSha,
  );
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

  patchCacheByFile.set(cacheKey(host, owner, repo, 'pull', number), patches);
  return files;
}

// ------------------------------------------------------------------ commit

interface RestCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
  files?: RestFile[];
}

/**
 * One request serves both the target and its file list.
 *
 * Unlike a pull request, a commit comes back whole: metadata, parents and
 * every file with its patch in a single response. Caching it here means the
 * content script's two questions cost one round trip rather than two.
 */
const commitCache = new Map<string, RestCommit>();

async function fetchCommit(
  host: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<RestCommit> {
  const key = cacheKey(host, owner, repo, 'commit', sha);
  const cached = commitCache.get(key);
  if (cached) return cached;

  const gh = hostFor(host);
  const commit = await restJson<RestCommit>(gh, `/repos/${owner}/${repo}/commits/${sha}`);
  commitCache.set(key, commit);

  const patches = new Map<string, string>();
  for (const file of commit.files ?? []) {
    if (file.patch) patches.set(file.filename, file.patch);
  }
  patchCacheByFile.set(cacheKey(host, owner, repo, 'commit', commit.sha), patches);

  return commit;
}

export async function getCommit(
  host: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<DiffTarget> {
  const commit = await fetchCommit(host, owner, repo, sha);

  return {
    kind: 'commit',
    host,
    owner,
    repo,
    number: null,
    // The subject line, which is what GitHub puts at the top of the page.
    title: commit.commit.message.split('\n')[0] ?? commit.sha.slice(0, 7),
    // A root commit has no parent: an empty base makes every file read as
    // added, which is exactly what it is.
    baseSha: commit.parents[0]?.sha ?? '',
    headSha: commit.sha,
    headOwner: owner,
    headRepo: repo,
  };
}

export async function listCommitFiles(
  host: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<ChangedFile[]> {
  const commit = await fetchCommit(host, owner, repo, sha);

  return (commit.files ?? []).map((file) => ({
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }));
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
async function targetPatch(target: DiffTarget): Promise<string | null> {
  const gh = hostFor(target.host);
  const key = targetKey(target);
  const cached = patchCache.get(key);
  if (cached !== undefined) return cached;

  const url =
    target.kind === 'pull'
      ? pullRequestDiffUrl(gh, target.owner, target.repo, target.number!)
      : commitDiffUrl(gh, target.owner, target.repo, target.headSha);

  let text: string | null = null;
  try {
    const response = await fetch(url, { credentials: 'include' });
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
  target: DiffTarget,
  file: ChangedFile,
  headText: string,
): Promise<string | null> {
  const patch = await targetPatch(target);
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
  target: DiffTarget,
  file: ChangedFile,
): Promise<CommentableLines> {
  const key = targetKey(target);
  const perFile = patchCacheByFile.get(key)?.get(file.path);

  if (perFile) {
    // A per-file patch has no "diff --git" header; parse-diff needs one.
    const parsed = parseUnifiedDiff(
      `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${perFile}\n`,
    );
    const found = parsed[0];
    if (found) return commentableLines(found.hunks);
  }

  const whole = await targetPatch(target);
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
export async function getFileDiff(target: DiffTarget, file: ChangedFile): Promise<FileDiffPayload> {
  const gh = hostFor(target.host);
  const basePath = file.previousPath ?? file.path;

  const [baseBlob, headText] = await Promise.all([
    file.status === 'added'
      ? Promise.resolve(null)
      : tryGetFileContent(target.host, target.owner, target.repo, target.baseSha, basePath),
    file.status === 'removed'
      ? Promise.resolve(null)
      : getFileContent(target.host, target.headOwner, target.headRepo, target.headSha, file.path),
  ]);

  let baseText = baseBlob;
  if (baseText === null && file.status !== 'added' && headText !== null) {
    baseText = await reconstructBaseText(target, file, headText);
  }

  return {
    target,
    file,
    commentableLines: await resolveCommentableLines(target, file),
    baseText: baseText ?? '',
    headText: headText ?? '',
    baseAssetUrl: assetBase(gh, target.owner, target.repo, target.baseSha, basePath),
    headAssetUrl: assetBase(gh, target.headOwner, target.headRepo, target.headSha, file.path),
    baseLinkUrl: linkBase(gh, target.owner, target.repo, target.baseSha, basePath),
    headLinkUrl: linkBase(gh, target.headOwner, target.headRepo, target.headSha, file.path),
    authenticated: (await getToken(target.host)) !== null,
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

/**
 * Comments on one file, whatever is being diffed.
 *
 * A pull request has review threads; a commit has a flat list of comments
 * addressed by diff position. The overlay knows only about threads, so a
 * commit comment becomes a thread of one — which is exactly what it is.
 */
export async function listComments(target: DiffTarget, path?: string): Promise<ReviewThread[]> {
  return target.kind === 'commit'
    ? listCommitComments(target, path)
    : listReviewThreads(target, path);
}

/** Threads for one file. GraphQL is the only source that reports resolved state. */
export async function listReviewThreads(
  target: DiffTarget,
  path?: string,
): Promise<ReviewThread[]> {
  const gh = hostFor(target.host);
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 20; page++) {
    const data: GqlThreadsResponse = await graphql<GqlThreadsResponse>(gh, THREADS_QUERY, {
      owner: target.owner,
      repo: target.repo,
      number: target.number,
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

// ---------------------------------------------------------- commit comments

interface RestCommitComment {
  id: number;
  node_id: string;
  path: string | null;
  position: number | null;
  body: string;
  created_at: string;
  html_url: string;
  user: { login: string; avatar_url: string; html_url: string } | null;
}

/**
 * The position map for one file of a commit, built from the patch the commit
 * request already returned. Null when the file has no patch — GitHub omits it
 * for binaries and for anything it considers too large — and then a comment on
 * that file cannot be placed, only listed as outdated.
 */
async function positionMapFor(target: DiffTarget, path: string): Promise<PositionMap | null> {
  await fetchCommit(target.host, target.owner, target.repo, target.headSha);
  const patch = patchCacheByFile.get(targetKey(target))?.get(path);
  return patch ? buildPositionMap(patch) : null;
}

async function listCommitComments(target: DiffTarget, path?: string): Promise<ReviewThread[]> {
  const gh = hostFor(target.host);
  const comments: RestCommitComment[] = [];

  for (let page = 1; page <= 10; page++) {
    const batch = await restJson<RestCommitComment[]>(
      gh,
      `/repos/${target.owner}/${target.repo}/commits/${target.headSha}/comments?per_page=100&page=${page}`,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }

  const viewer = await currentLogin(target.host);
  const maps = new Map<string, PositionMap | null>();
  const threads: ReviewThread[] = [];

  for (const comment of comments) {
    // A comment with no path is on the commit as a whole, not on a file.
    if (!comment.path) continue;
    if (path !== undefined && comment.path !== path) continue;

    if (!maps.has(comment.path)) {
      maps.set(comment.path, await positionMapFor(target, comment.path));
    }
    const map = maps.get(comment.path) ?? null;
    const anchor = map && comment.position !== null ? anchorFor(map, comment.position) : null;

    threads.push({
      id: comment.node_id,
      path: comment.path,
      // No anchor means the position no longer resolves — the same situation a
      // stale review thread is in, and it is shown the same way.
      line: anchor?.line ?? null,
      startLine: null,
      originalLine: anchor?.line ?? null,
      side: anchor?.side ?? 'RIGHT',
      startSide: null,
      isResolved: false,
      isOutdated: anchor === null,
      // Commit comments have no resolve state and no replies: GitHub offers
      // neither, so neither is offered here.
      viewerCanResolve: false,
      viewerCanUnresolve: false,
      diffHunk: '',
      comments: [
        {
          id: comment.node_id,
          databaseId: comment.id,
          author: comment.user
            ? {
                login: comment.user.login,
                avatarUrl: comment.user.avatar_url,
                url: comment.user.html_url,
              }
            : null,
          bodyMarkdown: comment.body,
          createdAt: comment.created_at,
          url: comment.html_url,
          viewerDidAuthor: viewer !== null && comment.user?.login === viewer,
        },
      ],
    });
  }

  return threads;
}

/**
 * Who the token belongs to, so a commit comment can say whether the reader
 * wrote it. The REST payload has no equivalent of GraphQL's viewerDidAuthor.
 */
async function currentLogin(host: string): Promise<string | null> {
  try {
    return (await getViewer(host)).login;
  } catch {
    return null;
  }
}

async function createCommitComment(target: DiffTarget, input: NewCommentInput): Promise<void> {
  const gh = hostFor(target.host);
  const map = await positionMapFor(target, input.path);
  const position = map ? positionFor(map, input.side, input.line) : null;

  if (position === null) {
    throw new ApiError(
      'invalid',
      'That line is not part of this commit’s diff, and a commit comment can only be attached to one.',
      422,
    );
  }

  await restJson<RestCommitComment>(
    gh,
    `/repos/${target.owner}/${target.repo}/commits/${target.headSha}/comments`,
    { method: 'POST', body: { body: input.body, path: input.path, position } },
  );
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
  target: DiffTarget,
  input: NewCommentInput,
): Promise<void> {
  if (target.kind === 'commit') return createCommitComment(target, input);

  const gh = hostFor(target.host);
  const body: Record<string, unknown> = {
    body: input.body,
    commit_id: target.headSha,
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
    `/repos/${target.owner}/${target.repo}/pulls/${target.number}/comments`,
    { method: 'POST', body },
  );
}

export async function replyToComment(
  target: DiffTarget,
  inReplyToDatabaseId: number,
  body: string,
): Promise<void> {
  if (target.kind === 'commit') {
    throw new ApiError(
      'invalid',
      'GitHub has no replies on commit comments — they are a flat list. Comment on the same line instead.',
      400,
    );
  }

  const gh = hostFor(target.host);
  await restJson<RestComment>(
    gh,
    `/repos/${target.owner}/${target.repo}/pulls/${target.number}/comments/${inReplyToDatabaseId}/replies`,
    { method: 'POST', body: { body } },
  );
}

/**
 * Where a single comment lives, which is not the same path for the two kinds:
 * a review comment hangs off the pull request, a commit comment off the
 * repository.
 */
function commentPath(target: DiffTarget, databaseId: number): string {
  return target.kind === 'commit'
    ? `/repos/${target.owner}/${target.repo}/comments/${databaseId}`
    : `/repos/${target.owner}/${target.repo}/pulls/comments/${databaseId}`;
}

export async function updateComment(
  target: DiffTarget,
  databaseId: number,
  body: string,
): Promise<void> {
  const gh = hostFor(target.host);
  await restJson<RestComment>(gh, commentPath(target, databaseId), {
    method: 'PATCH',
    body: { body },
  });
}

export async function deleteComment(target: DiffTarget, databaseId: number): Promise<void> {
  const gh = hostFor(target.host);
  await rest(gh, commentPath(target, databaseId), { method: 'DELETE' });
}

export async function addReaction(
  target: DiffTarget,
  databaseId: number,
  content: string,
): Promise<void> {
  const gh = hostFor(target.host);
  await restJson(gh, `${commentPath(target, databaseId)}/reactions`, {
    method: 'POST',
    body: { content },
  });
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
  target: DiffTarget,
  threadId: string,
  resolved: boolean,
): Promise<void> {
  const gh = hostFor(target.host);
  await graphql(gh, resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { threadId });
}
