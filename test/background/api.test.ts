import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangedFile, DiffTarget } from '@shared/github';

vi.mock('../../src/background/tokenStore', () => ({
  getToken: async () => 'gho_test',
}));

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];

function respond(
  handler: (call: Call) => { status?: number; body?: string; headers?: Record<string, string> },
) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const result = handler(call);
    const headers = new Headers(result.headers ?? {});
    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      headers,
      text: async () => result.body ?? '',
    } as Response;
  });
}

async function api() {
  vi.resetModules();
  return import('../../src/background/api');
}

const PR: DiffTarget = {
  kind: 'pull',
  host: 'github.com',
  owner: 'own',
  repo: 'repo',
  number: 7,
  title: 'Docs',
  baseSha: 'base123',
  headSha: 'head456',
  headOwner: 'fork',
  headRepo: 'repo',
};

const FILE: ChangedFile = {
  path: 'docs/guide.md',
  previousPath: null,
  status: 'modified',
  additions: 3,
  deletions: 1,
};

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('error mapping', () => {
  const cases: [number, Record<string, string>, string][] = [
    [401, {}, 'unauthenticated'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, 'rate-limited'],
    [403, {}, 'forbidden'],
    [404, {}, 'not-found'],
    [422, {}, 'invalid'],
    [500, {}, 'server'],
  ];

  it.each(cases)('maps HTTP %i to %s', async (status, headers, kind) => {
    respond(() => ({ status, body: '{}', headers }));
    const { getPullRequest } = await api();
    await expect(getPullRequest('github.com', 'own', 'repo', 7)).rejects.toMatchObject({ kind });
  });

  it('reports when a rate limit resets', async () => {
    respond(() => ({
      status: 403,
      body: '{}',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
    }));
    const { getPullRequest } = await api();
    await expect(getPullRequest('github.com', 'own', 'repo', 7)).rejects.toMatchObject({
      retryAt: 1700000000000,
    });
  });

  it('turns a dead host into a network error rather than an unhandled rejection', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('connection refused');
    });
    const { getPullRequest } = await api();
    await expect(getPullRequest('github.com', 'own', 'repo', 7)).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('pull request data', () => {
  it('reads base and head, falling back to the base repo for a deleted fork', async () => {
    respond(() => ({
      body: JSON.stringify({
        title: 'Docs',
        base: { sha: 'base123', repo: { name: 'repo', owner: { login: 'own' } } },
        head: { sha: 'head456', repo: null },
      }),
    }));

    const { getPullRequest } = await api();
    const pr = await getPullRequest('github.com', 'own', 'repo', 7);

    expect(pr).toMatchObject({ baseSha: 'base123', headSha: 'head456', headOwner: 'own' });
    expect(calls[0]!.url).toBe('https://api.github.com/repos/own/repo/pulls/7');
    expect(calls[0]!.headers.Authorization).toBe('Bearer gho_test');
  });

  it('pages through the changed files', async () => {
    const page = (n: number) =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          filename: `f${i}.md`,
          status: 'modified',
          additions: 1,
          deletions: 0,
        })),
      );
    const pageOf = (url: string) => Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
    respond((call) => ({ body: pageOf(call.url) === 1 ? page(100) : page(2) }));

    const { listPullRequestFiles } = await api();
    const files = await listPullRequestFiles('github.com', 'own', 'repo', 7);

    expect(files).toHaveLength(102);
    expect(calls).toHaveLength(2);
  });
});

describe('file contents', () => {
  it('fetches each side from its own repository and commit', async () => {
    respond((call) => ({ body: call.url.includes('base123') ? 'old body' : 'new body' }));

    const { getFileDiff } = await api();
    const payload = await getFileDiff(PR, FILE);

    expect(payload.baseText).toBe('old body');
    expect(payload.headText).toBe('new body');
    expect(calls[0]!.headers.Accept).toBe('application/vnd.github.raw');
    expect(
      calls.some((c) => c.url.includes('/repos/own/repo/contents/') && c.url.includes('base123')),
    ).toBe(true);
    expect(
      calls.some((c) => c.url.includes('/repos/fork/repo/contents/') && c.url.includes('head456')),
    ).toBe(true);
  });

  it('builds per-side asset and link bases pointing at the right commit', async () => {
    respond(() => ({ body: 'x' }));
    const { getFileDiff } = await api();
    const payload = await getFileDiff(PR, FILE);

    // The web host's /raw/ path, not raw.githubusercontent.com: it redirects
    // with a signed token, so images in a private repository still load.
    expect(payload.baseAssetUrl).toBe('https://github.com/own/repo/raw/base123/docs/');
    expect(payload.headAssetUrl).toBe('https://github.com/fork/repo/raw/head456/docs/');
    expect(payload.baseLinkUrl).toBe('https://github.com/own/repo/blob/base123/docs/');
  });

  it('does not ask for the base side of an added file', async () => {
    respond(() => ({ body: 'new only' }));
    const { getFileDiff } = await api();
    const payload = await getFileDiff(PR, { ...FILE, status: 'added' });

    expect(payload.baseText).toBe('');
    expect(calls.every((c) => !c.url.includes('base123'))).toBe(true);
  });

  it('follows a rename back to its previous path on the base side', async () => {
    respond(() => ({ body: 'x' }));
    const { getFileDiff } = await api();
    await getFileDiff(PR, { ...FILE, status: 'renamed', previousPath: 'docs/old.md' });

    expect(
      calls.some((c) => c.url.includes('docs%2Fold.md') || c.url.includes('docs/old.md')),
    ).toBe(true);
  });

  it('treats a missing base file as empty instead of an error', async () => {
    respond((call) =>
      call.url.includes('base123') ? { status: 404, body: '{}' } : { body: 'new' },
    );
    const { getFileDiff } = await api();
    const payload = await getFileDiff(PR, FILE);
    expect(payload.baseText).toBe('');
    expect(payload.headText).toBe('new');
  });
});

describe('comment writes', () => {
  it('anchors a single-line comment to the head commit and the given side', async () => {
    respond(() => ({ body: '{}' }));
    const { createReviewComment } = await api();

    await createReviewComment(PR, {
      path: 'docs/guide.md',
      side: 'RIGHT',
      line: 12,
      body: 'Needs work',
    });

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/own/repo/pulls/7/comments');
    expect(calls[0]!.body).toEqual({
      body: 'Needs work',
      commit_id: 'head456',
      path: 'docs/guide.md',
      side: 'RIGHT',
      line: 12,
    });
  });

  it('sends a multi-line range only when the start really differs', async () => {
    respond(() => ({ body: '{}' }));
    const { createReviewComment } = await api();

    await createReviewComment(PR, {
      path: 'docs/guide.md',
      side: 'RIGHT',
      line: 12,
      startLine: 9,
      startSide: 'RIGHT',
      body: 'Range',
    });
    await createReviewComment(PR, {
      path: 'docs/guide.md',
      side: 'RIGHT',
      line: 12,
      startLine: 12,
      body: 'Single',
    });

    expect(calls[0]!.body).toMatchObject({ start_line: 9, start_side: 'RIGHT' });
    expect(calls[1]!.body).not.toHaveProperty('start_line');
  });

  it('posts a reply against the comment it answers', async () => {
    respond(() => ({ body: '{}' }));
    const { replyToComment } = await api();
    await replyToComment(PR, 99, 'Agreed');

    expect(calls[0]!.url).toBe('https://api.github.com/repos/own/repo/pulls/7/comments/99/replies');
    expect(calls[0]!.body).toEqual({ body: 'Agreed' });
  });

  it('resolves and unresolves through GraphQL', async () => {
    respond(() => ({ body: JSON.stringify({ data: { resolveReviewThread: {} } }) }));
    const { setThreadResolved } = await api();

    await setThreadResolved(PR, 'THREAD', true);
    await setThreadResolved(PR, 'THREAD', false);

    expect(calls[0]!.url).toBe('https://api.github.com/graphql');
    expect(String((calls[0]!.body as { query: string }).query)).toContain('resolveReviewThread');
    expect(String((calls[1]!.body as { query: string }).query)).toContain('unresolveReviewThread');
  });

  it('surfaces GraphQL errors instead of silently returning nothing', async () => {
    respond(() => ({ body: JSON.stringify({ errors: [{ message: 'Resource not accessible' }] }) }));
    const { setThreadResolved } = await api();

    await expect(setThreadResolved(PR, 'THREAD', true)).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('Resource not accessible'),
    });
  });
});

describe('enterprise hosts', () => {
  it('uses the instance api and raw paths', async () => {
    respond(() => ({ body: 'content' }));
    const { getFileDiff } = await api();

    const payload = await getFileDiff({ ...PR, host: 'git.example.com' }, FILE);

    expect(calls[0]!.url.startsWith('https://git.example.com/api/v3/')).toBe(true);
    expect(payload.baseAssetUrl).toBe('https://git.example.com/own/repo/raw/base123/docs/');
  });
});

describe('scope reporting', () => {
  it('reports a classic token that lacks repo', async () => {
    respond(() => ({
      body: JSON.stringify({ login: 'octocat', avatar_url: 'a' }),
      headers: { 'x-oauth-scopes': 'read:user, gist' },
    }));
    const { getViewer, missingScopes } = await api();
    expect(missingScopes(await getViewer('github.com'))).toEqual(['repo']);
  });

  it('accepts a classic token carrying repo', async () => {
    respond(() => ({
      body: JSON.stringify({ login: 'octocat', avatar_url: 'a' }),
      headers: { 'x-oauth-scopes': 'repo, read:org' },
    }));
    const { getViewer, missingScopes } = await api();
    expect(missingScopes(await getViewer('github.com'))).toEqual([]);
  });

  it('does not cry wolf over a fine-grained token, which reports no scopes', async () => {
    respond(() => ({ body: JSON.stringify({ login: 'octocat', avatar_url: 'a' }) }));
    const { getViewer, missingScopes } = await api();
    const viewer = await getViewer('github.com');
    expect(viewer.scopes).toEqual([]);
    expect(missingScopes(viewer)).toEqual([]);
  });
});

// ------------------------------------------------------------------ commits

const COMMIT_SHA = 'c5d7dbdde8d8739012cf48187511641f732548b8';

/**
 * Two context lines, one removal and one addition, so every branch of the
 * position walk is exercised by the endpoint tests as well.
 */
const COMMIT_PATCH = ['@@ -1,3 +1,3 @@', ' intro', '-was', '+is', ' outro'].join('\n');

const COMMIT_BODY = JSON.stringify({
  sha: COMMIT_SHA,
  commit: { message: 'Describe design decisions\n\nLonger body.' },
  parents: [{ sha: '629ae3df6350476cd8161df16c608226c2cb831c' }],
  files: [
    {
      filename: 'docs/DESIGN.md',
      status: 'modified',
      additions: 1,
      deletions: 1,
      patch: COMMIT_PATCH,
    },
  ],
});

describe('commits as a diff target', () => {
  it('takes the parent as the base and the subject as the title', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const { getCommit } = await api();

    const target = await getCommit('github.com', 'own', 'repo', COMMIT_SHA);

    expect(target).toMatchObject({
      kind: 'commit',
      number: null,
      title: 'Describe design decisions',
      baseSha: '629ae3df6350476cd8161df16c608226c2cb831c',
      headSha: COMMIT_SHA,
    });
  });

  it('reads a root commit as an empty base rather than failing', async () => {
    respond(() => ({ body: JSON.stringify({ ...JSON.parse(COMMIT_BODY), parents: [] }) }));
    const { getCommit } = await api();

    expect((await getCommit('github.com', 'own', 'repo', COMMIT_SHA)).baseSha).toBe('');
  });

  it('serves the target and the file list from one request', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const module = await api();

    await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);
    const files = await module.listCommitFiles('github.com', 'own', 'repo', COMMIT_SHA);

    expect(files).toEqual([
      {
        path: 'docs/DESIGN.md',
        previousPath: null,
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('posts a comment to the commit, addressed by diff position', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);
    calls = [];

    await module.createReviewComment(target, {
      path: 'docs/DESIGN.md',
      side: 'RIGHT',
      line: 2,
      body: 'Why the change?',
    });

    const post = calls.find((call) => call.method === 'POST')!;
    expect(post.url).toBe(`https://api.github.com/repos/own/repo/commits/${COMMIT_SHA}/comments`);
    // RIGHT line 2 is the added line, third down from the hunk header.
    expect(post.body).toEqual({ body: 'Why the change?', path: 'docs/DESIGN.md', position: 3 });
  });

  it('refuses a line the commit does not touch instead of letting GitHub 422', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);

    await expect(
      module.createReviewComment(target, {
        path: 'docs/DESIGN.md',
        side: 'RIGHT',
        line: 99,
        body: 'x',
      }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('edits and deletes through the repository comment path, not the pulls one', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);
    calls = [];

    await module.updateComment(target, 42, 'edited');
    await module.deleteComment(target, 42);

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PATCH https://api.github.com/repos/own/repo/comments/42',
      'DELETE https://api.github.com/repos/own/repo/comments/42',
    ]);
  });

  it('says plainly that commit comments have no replies', async () => {
    respond(() => ({ body: COMMIT_BODY }));
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);

    await expect(module.replyToComment(target, 42, 'hi')).rejects.toThrow(/flat list/);
  });

  it('places a commit comment on the line its position resolves to', async () => {
    respond((call) =>
      call.url.endsWith('/comments?per_page=100&page=1')
        ? {
            body: JSON.stringify([
              {
                id: 7,
                node_id: 'NODE7',
                path: 'docs/DESIGN.md',
                position: 3,
                body: 'note',
                created_at: '2026-01-01T00:00:00Z',
                html_url: 'https://github.com/own/repo/commit/x#c7',
                user: { login: 'octocat', avatar_url: 'a', html_url: 'u' },
              },
            ]),
          }
        : { body: COMMIT_BODY },
    );
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);

    const threads = await module.listComments(target, 'docs/DESIGN.md');

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ line: 2, side: 'RIGHT', isOutdated: false });
    // No replies and no resolving: the overlay hides both when it sees this.
    expect(threads[0]!.viewerCanResolve).toBe(false);
    expect(threads[0]!.comments).toHaveLength(1);
  });

  it('treats a comment whose position no longer resolves as outdated', async () => {
    respond((call) =>
      call.url.endsWith('/comments?per_page=100&page=1')
        ? {
            body: JSON.stringify([
              {
                id: 8,
                node_id: 'NODE8',
                path: 'docs/DESIGN.md',
                position: null,
                body: 'stale',
                created_at: '2026-01-01T00:00:00Z',
                html_url: 'https://github.com/own/repo/commit/x#c8',
                user: null,
              },
            ]),
          }
        : { body: COMMIT_BODY },
    );
    const module = await api();
    const target = await module.getCommit('github.com', 'own', 'repo', COMMIT_SHA);

    const threads = await module.listComments(target, 'docs/DESIGN.md');

    expect(threads[0]).toMatchObject({ line: null, isOutdated: true });
  });
});
