import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../support/chromeMock';

/**
 * The popup asks for this the instant it opens, so the cheap path matters:
 * answering used to mean a round trip to GitHub every single time.
 */

const USER = { login: 'octocat', avatar_url: 'https://example.invalid/a.png' };

/** Counts requests to /user; everything else is an unexpected call. */
function mockFetch() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'x-oauth-scopes': 'repo' }),
      text: async () => JSON.stringify(USER),
    } as unknown as Response;
  });
  return calls;
}

async function freshModules() {
  vi.resetModules();
  const tokenStore = await import('../../src/background/tokenStore');
  const auth = await import('../../src/background/auth');
  return { tokenStore, auth };
}

describe('authStatus', () => {
  beforeEach(() => {
    installChromeMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks GitHub who the token belongs to only once', async () => {
    const calls = mockFetch();
    const { tokenStore, auth } = await freshModules();
    await tokenStore.setToken('github.com', 'gho_secret', {
      login: '',
      scopes: [],
      source: 'manual',
    });

    const first = await auth.authStatus('github.com');
    const second = await auth.authStatus('github.com');

    expect(first.viewer?.login).toBe('octocat');
    expect(second.viewer?.login).toBe('octocat');
    expect(second.connected).toBe(true);
    expect(calls.filter((url) => url.endsWith('/user'))).toHaveLength(1);
  });

  it('forgets the account when the token goes away', async () => {
    const calls = mockFetch();
    const { tokenStore, auth } = await freshModules();
    await tokenStore.setToken('github.com', 'gho_secret', {
      login: '',
      scopes: [],
      source: 'manual',
    });
    await auth.authStatus('github.com');

    await tokenStore.clearToken('github.com');
    expect(await auth.authStatus('github.com')).toMatchObject({ connected: false, viewer: null });

    // A new token must be verified against GitHub rather than answered from
    // the previous account's cache.
    await tokenStore.setToken('github.com', 'gho_other', {
      login: '',
      scopes: [],
      source: 'manual',
    });
    await auth.authStatus('github.com');

    expect(calls.filter((url) => url.endsWith('/user'))).toHaveLength(2);
  });
});
