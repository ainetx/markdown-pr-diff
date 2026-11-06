/**
 * Where to reach a GitHub instance.
 *
 * github.com and GitHub Enterprise differ in every base URL, so the rest of
 * the code asks this module rather than hard-coding hosts.
 */

export const DOT_COM = 'github.com';

export interface GitHubHost {
  /** Hostname of the web UI, e.g. `github.com` or `git.example.com`. */
  host: string;
  /** Origin of the web UI. */
  web: string;
  /** REST base, no trailing slash. */
  api: string;
  /** GraphQL endpoint. */
  graphql: string;
  /** OAuth device-flow endpoints live on the web host. */
  deviceCodeUrl: string;
  tokenUrl: string;
  /** Where a user approves a device-flow request. */
  verificationUrl: string;
  isDotCom: boolean;
}

export function hostFor(hostname: string): GitHubHost {
  const host = hostname.toLowerCase();
  const web = `https://${host}`;
  const isDotCom = host === DOT_COM;

  return {
    host,
    web,
    api: isDotCom ? 'https://api.github.com' : `${web}/api/v3`,
    graphql: isDotCom ? 'https://api.github.com/graphql' : `${web}/api/graphql`,
    deviceCodeUrl: `${web}/login/device/code`,
    tokenUrl: `${web}/login/oauth/access_token`,
    verificationUrl: `${web}/login/device`,
    isDotCom,
  };
}

/**
 * Raw file URL for a blob at a specific commit.
 *
 * Deliberately the web host's /raw/ path rather than raw.githubusercontent.com:
 * for a private repository the web host issues a redirect carrying a signed
 * token, so the URL works with nothing but the browser's own session — both
 * for our fetches and for images the rendered markdown points at. The
 * raw.githubusercontent.com form only ever works for public repositories.
 */
export function rawUrl(
  gh: GitHubHost,
  owner: string,
  repo: string,
  sha: string,
  path: string,
): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${gh.web}/${owner}/${repo}/raw/${sha}/${encodedPath}`;
}

/** The pull request's patch, readable with the browser session alone. */
export function pullRequestDiffUrl(
  gh: GitHubHost,
  owner: string,
  repo: string,
  number: number,
): string {
  return `${gh.web}/${owner}/${repo}/pull/${number}.diff`;
}

/** The same for a single commit. */
export function commitDiffUrl(gh: GitHubHost, owner: string, repo: string, sha: string): string {
  return `${gh.web}/${owner}/${repo}/commit/${sha}.diff`;
}

/** Base URL that relative asset references in a file resolve against. */
export function assetBase(
  gh: GitHubHost,
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
): string {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  return rawUrl(gh, owner, repo, sha, dir);
}

/** Base URL that relative in-repo links resolve against. */
export function linkBase(
  gh: GitHubHost,
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
): string {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  return `${gh.web}/${owner}/${repo}/blob/${sha}/${dir}`;
}

export interface PullRequestRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

/** Parses a pull-request location such as /owner/repo/pull/42/files. */
export function parsePullRequestUrl(url: string | URL): PullRequestRef | null {
  const parsed = typeof url === 'string' ? safeUrl(url) : url;
  if (!parsed) return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  if (!match) return null;
  return {
    host: parsed.hostname,
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
  };
}

export interface PullRequestRangeRef extends PullRequestRef {
  /** The commit the range starts after. */
  base: string;
  /** The commit the range ends at. */
  head: string;
}

/**
 * Parses a pull request narrowed to a commit range, such as
 * /owner/repo/pull/42/changes/aaaaaaa..bbbbbbb.
 *
 * GitHub offers this whenever a reviewer asks what changed since they last
 * looked, and the page then shows only those commits. Reading it as a plain
 * pull request shows the whole of it instead — a file added earlier in the
 * branch appears wholly new rather than lightly edited.
 */
export function parsePullRequestRange(url: string | URL): PullRequestRangeRef | null {
  const parsed = typeof url === 'string' ? safeUrl(url) : url;
  if (!parsed) return null;
  const match =
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)\/([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})(?:\/|$)/i.exec(
      parsed.pathname,
    );
  if (!match) return null;
  return {
    host: parsed.hostname,
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
    base: match[4]!,
    head: match[5]!,
  };
}

export interface CommitRef {
  host: string;
  owner: string;
  repo: string;
  sha: string;
}

/**
 * Parses a commit location such as /owner/repo/commit/<sha>.
 *
 * Deliberately not /owner/repo/pull/42/commits/<sha>: that page shows one
 * commit of a pull request, and its comments are review comments on the pull
 * request rather than commit comments, so treating it as a bare commit would
 * post to the wrong place.
 */
export function parseCommitUrl(url: string | URL): CommitRef | null {
  const parsed = typeof url === 'string' ? safeUrl(url) : url;
  if (!parsed) return null;
  const match = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})(?:\/|$)/i.exec(parsed.pathname);
  if (!match) return null;
  return {
    host: parsed.hostname,
    owner: match[1]!,
    repo: match[2]!,
    sha: match[3]!,
  };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
