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

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
