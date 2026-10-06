/**
 * GitHub OAuth Device Flow.
 *
 * The only way for an extension to obtain a token without a backend: the web
 * flow would need a client secret to exchange the code, and GitHub's OAuth
 * Apps do not support PKCE. The device flow is designed for exactly this —
 * a public client id, a code the user approves in a normal browser tab, and a
 * polled exchange that needs no secret.
 */

import type { GitHubHost } from '@shared/githubHost';

export type DeviceFlowErrorCode =
  | 'device_flow_disabled'
  | 'expired_token'
  | 'access_denied'
  | 'unsupported'
  | 'network'
  | 'aborted'
  | 'unknown';

export class DeviceFlowError extends Error {
  constructor(
    readonly code: DeviceFlowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceFlowError';
  }
}

export interface DeviceFlowSession {
  /** Shown to the user, e.g. ABCD-1234. */
  userCode: string;
  /** Tab to open; already carries the user code where GitHub supports it. */
  verificationUri: string;
  expiresAt: number;
  deviceCode: string;
  intervalMs: number;
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface TokenResponse {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postJson<T>(url: string, body: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new DeviceFlowError('network', `cannot reach ${url}: ${String(cause)}`);
  }

  if (response.status === 404) {
    throw new DeviceFlowError(
      'unsupported',
      'This GitHub instance does not expose the device flow endpoints. Use a personal access token instead.',
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DeviceFlowError('unknown', `unexpected response from ${url}: ${text.slice(0, 200)}`);
  }
}

function describe(error: string, fallback: string): string {
  switch (error) {
    case 'device_flow_disabled':
      return 'The OAuth App has device flow turned off. Enable "Device Flow" in its settings on GitHub, then try again.';
    case 'expired_token':
      return 'The authorization code expired before it was approved. Start again.';
    case 'access_denied':
      return 'Authorization was declined on GitHub.';
    case 'incorrect_client_credentials':
      return 'The configured OAuth client id is not valid for this GitHub instance.';
    default:
      return fallback;
  }
}

export async function startDeviceFlow(
  gh: GitHubHost,
  clientId: string,
  scopes: string,
): Promise<DeviceFlowSession> {
  if (!clientId) {
    throw new DeviceFlowError(
      'unsupported',
      'No OAuth client id is configured for this host. Add one in the options, or paste a personal access token.',
    );
  }

  const data = await postJson<DeviceCodeResponse>(gh.deviceCodeUrl, {
    client_id: clientId,
    scope: scopes,
  });

  if (data.error || !data.device_code || !data.user_code) {
    const code: DeviceFlowErrorCode =
      data.error === 'device_flow_disabled' ? 'device_flow_disabled' : 'unknown';
    throw new DeviceFlowError(
      code,
      describe(
        data.error ?? '',
        data.error_description ?? 'GitHub refused the device code request.',
      ),
    );
  }

  const intervalSec = data.interval ?? 5;
  const expiresInSec = data.expires_in ?? 900;

  return {
    userCode: data.user_code,
    verificationUri:
      data.verification_uri_complete ??
      `${data.verification_uri ?? gh.verificationUrl}?user_code=${encodeURIComponent(data.user_code)}`,
    expiresAt: Date.now() + expiresInSec * 1000,
    deviceCode: data.device_code,
    intervalMs: intervalSec * 1000,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeviceFlowError('aborted', 'authorization cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DeviceFlowError('aborted', 'authorization cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface DeviceFlowResult {
  token: string;
  scopes: string[];
}

/**
 * Polls until the user approves, declines, or the code expires. Honours the
 * interval GitHub asks for, backs off when told to, and always terminates.
 */
export async function pollForToken(
  gh: GitHubHost,
  clientId: string,
  session: DeviceFlowSession,
  signal?: AbortSignal,
): Promise<DeviceFlowResult> {
  let intervalMs = session.intervalMs;

  for (;;) {
    if (Date.now() >= session.expiresAt) {
      throw new DeviceFlowError('expired_token', describe('expired_token', ''));
    }

    await sleep(intervalMs, signal);

    const data = await postJson<TokenResponse>(gh.tokenUrl, {
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) {
      return {
        token: data.access_token,
        scopes: (data.scope ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }

    switch (data.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        // GitHub asks for five extra seconds whenever it sends this.
        intervalMs += 5000;
        continue;
      case 'expired_token':
        throw new DeviceFlowError('expired_token', describe('expired_token', ''));
      case 'access_denied':
        throw new DeviceFlowError('access_denied', describe('access_denied', ''));
      default:
        throw new DeviceFlowError(
          'unknown',
          describe(data.error ?? '', data.error_description ?? 'GitHub refused the token request.'),
        );
    }
  }
}
