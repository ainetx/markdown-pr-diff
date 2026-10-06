import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, type ChromeMock } from '../support/chromeMock';

let chromeMock: ChromeMock;

/** Fresh module state: the store caches both the key and the plaintext. */
async function freshStore() {
  vi.resetModules();
  return import('../../src/background/tokenStore');
}

describe('tokenStore', () => {
  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('round-trips a token', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: ['repo'],
      source: 'device-flow',
    });

    expect(await store.getToken('github.com')).toBe('gho_secret');
  });

  it('never writes the token to local storage in readable form', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: ['repo'],
      source: 'device-flow',
    });

    const dumped = JSON.stringify([...chromeMock.storage.local._data.entries()]);
    expect(dumped).not.toContain('gho_secret');
    expect(dumped).toContain('token:github.com');
  });

  it('decrypts from disk after the in-memory and session copies are gone', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: ['repo'],
      source: 'manual',
    });

    // Simulate a worker restart: module state and session storage both reset.
    chromeMock.storage.session._data.clear();
    const restarted = await freshStore();
    expect(await restarted.getToken('github.com')).toBe('gho_secret');
  });

  it('keeps metadata readable without decrypting anything', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: ['repo'],
      source: 'device-flow',
    });

    const meta = await store.getTokenMeta('github.com');
    expect(meta).toMatchObject({ host: 'github.com', login: 'octocat', source: 'device-flow' });
    expect(JSON.stringify(meta)).not.toContain('gho_secret');
  });

  it('keeps hosts separate', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'dotcom', {
      login: 'a',
      scopes: [],
      source: 'manual',
    });
    await store.setToken('ghe.example', 'enterprise', {
      login: 'b',
      scopes: [],
      source: 'manual',
    });

    expect(await store.getToken('github.com')).toBe('dotcom');
    expect(await store.getToken('ghe.example')).toBe('enterprise');
  });

  it('forgets everything about a host on clear', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: [],
      source: 'manual',
    });
    await store.clearToken('github.com');

    expect(await store.getToken('github.com')).toBeNull();
    expect(await store.getTokenMeta('github.com')).toBeNull();
    expect(JSON.stringify([...chromeMock.storage.local._data.keys()])).not.toContain('github.com');
  });

  it('asks the user to reconnect instead of throwing when the key is gone', async () => {
    const store = await freshStore();
    await store.setToken('github.com', 'gho_secret', {
      login: 'octocat',
      scopes: [],
      source: 'manual',
    });

    // Losing the key makes the stored blob permanently unreadable. The store
    // must degrade to "not connected", not fail every later call.
    indexedDB.deleteDatabase('mdpd-keys');
    await new Promise((resolve) => setTimeout(resolve, 10));
    chromeMock.storage.session._data.clear();

    const restarted = await freshStore();
    expect(await restarted.getToken('github.com')).toBeNull();
    expect(await restarted.getTokenMeta('github.com')).toBeNull();
  });
});
