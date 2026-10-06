/**
 * Connecting and disconnecting a GitHub account.
 */

import { GITHUB_CLIENT_ID, OAUTH_SCOPES } from '@shared/config';
import { DOT_COM, hostFor } from '@shared/githubHost';
import type { AuthStatus } from '@shared/messages';
import { loadSettings } from '@shared/settings';
import { ApiError, getViewer, missingScopes } from './api';
import { DeviceFlowError, pollForToken, startDeviceFlow } from './deviceFlow';
import { clearToken, getToken, getTokenMeta, setToken } from './tokenStore';
import { cacheViewer, cachedViewer } from './viewerCache';

/** The device-flow client id registered for a host, if there is one. */
export async function clientIdFor(host: string): Promise<string> {
  if (host === DOT_COM) return GITHUB_CLIENT_ID;
  const settings = await loadSettings();
  return settings.enterpriseHosts.find((entry) => entry.host === host)?.clientId ?? '';
}

export async function authStatus(host: string): Promise<AuthStatus> {
  // Independent of one another, and every one of them is a round trip to
  // storage: the popup asks for this the instant it opens.
  const [clientId, meta, token] = await Promise.all([
    clientIdFor(host),
    getTokenMeta(host),
    getToken(host),
  ]);
  const deviceFlowAvailable = clientId !== '';

  if (!token) {
    return {
      connected: false,
      meta: null,
      viewer: null,
      missingScopes: [],
      deviceFlowAvailable,
      problem: meta ? 'The stored token could not be read and was discarded.' : null,
    };
  }

  const known = await cachedViewer(host);
  if (known) {
    return {
      connected: true,
      meta,
      viewer: known,
      missingScopes: missingScopes(known),
      deviceFlowAvailable,
      problem: null,
    };
  }

  try {
    const viewer = await getViewer(host);
    await cacheViewer(host, viewer);
    return {
      connected: true,
      meta,
      viewer,
      missingScopes: missingScopes(viewer),
      deviceFlowAvailable,
      problem: null,
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    // A rejected token is worse than no token: it makes every later call fail
    // in a confusing way. Drop it and say so.
    if (error instanceof ApiError && error.kind === 'unauthenticated') {
      await clearToken(host);
      return {
        connected: false,
        meta: null,
        viewer: null,
        missingScopes: [],
        deviceFlowAvailable,
        problem: 'The stored token is no longer valid. Connect again.',
      };
    }
    return {
      connected: true,
      meta,
      viewer: null,
      missingScopes: [],
      deviceFlowAvailable,
      problem: message,
    };
  }
}

export async function storeVerifiedToken(
  host: string,
  token: string,
  source: 'device-flow' | 'manual',
  scopesFromFlow: string[] = [],
): Promise<AuthStatus> {
  // Store first so getViewer can authenticate with it, then verify. A token
  // that fails verification is removed again rather than left behind.
  await setToken(host, token, { login: '', scopes: scopesFromFlow, source });

  try {
    const viewer = await getViewer(host);
    await cacheViewer(host, viewer);
    const meta = await setToken(host, token, {
      login: viewer.login,
      scopes: viewer.scopes.length > 0 ? viewer.scopes : scopesFromFlow,
      source,
    });
    return {
      connected: true,
      meta,
      viewer,
      missingScopes: missingScopes(viewer),
      deviceFlowAvailable: (await clientIdFor(host)) !== '',
      problem: null,
    };
  } catch (error) {
    await clearToken(host);
    throw error;
  }
}

export async function disconnect(host: string): Promise<AuthStatus> {
  await clearToken(host);
  return authStatus(host);
}

export interface DeviceFlowCallbacks {
  onCode(session: { userCode: string; verificationUri: string; expiresAt: number }): void;
}

/**
 * Runs the whole device flow. The caller keeps a port open for the duration,
 * which is what stops the worker from idling out while the user approves.
 */
export async function runDeviceFlow(
  host: string,
  callbacks: DeviceFlowCallbacks,
  signal: AbortSignal,
): Promise<AuthStatus> {
  const gh = hostFor(host);
  const clientId = await clientIdFor(host);

  const session = await startDeviceFlow(gh, clientId, OAUTH_SCOPES);
  callbacks.onCode({
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    expiresAt: session.expiresAt,
  });

  const { token, scopes } = await pollForToken(gh, clientId, session, signal);
  return storeVerifiedToken(host, token, 'device-flow', scopes);
}

export function describeAuthError(error: unknown): string {
  if (error instanceof DeviceFlowError) return error.message;
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
