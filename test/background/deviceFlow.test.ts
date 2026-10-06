import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceFlowError, pollForToken, startDeviceFlow } from '../../src/background/deviceFlow';
import { hostFor } from '@shared/githubHost';

const gh = hostFor('github.com');

/** Queues canned JSON responses in call order. */
function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = [];
  let index = 0;

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return {
      status: next.status ?? 200,
      ok: (next.status ?? 200) < 400,
      text: async () => JSON.stringify(next.body),
    } as Response;
  });

  return calls;
}

const CODE_OK = {
  body: {
    device_code: 'DEV',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 0,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startDeviceFlow', () => {
  it('returns the user code and a verification url carrying it', async () => {
    mockFetch([CODE_OK]);
    const session = await startDeviceFlow(gh, 'CLIENT', 'repo');

    expect(session.userCode).toBe('ABCD-1234');
    expect(session.verificationUri).toContain('user_code=ABCD-1234');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it('prefers the complete verification url when GitHub supplies one', async () => {
    mockFetch([
      {
        body: {
          ...CODE_OK.body,
          verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234&x=1',
        },
      },
    ]);
    const session = await startDeviceFlow(gh, 'CLIENT', 'repo');
    expect(session.verificationUri).toBe('https://github.com/login/device?user_code=ABCD-1234&x=1');
  });

  it('explains that device flow is switched off rather than failing vaguely', async () => {
    mockFetch([{ body: { error: 'device_flow_disabled' } }]);

    await expect(startDeviceFlow(gh, 'CLIENT', 'repo')).rejects.toMatchObject({
      code: 'device_flow_disabled',
      message: expect.stringContaining('Enable "Device Flow"'),
    });
  });

  it('refuses to start without a configured client id', async () => {
    mockFetch([CODE_OK]);
    await expect(startDeviceFlow(gh, '', 'repo')).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it('reports an instance that has no device flow endpoints', async () => {
    mockFetch([{ status: 404, body: {} }]);
    await expect(startDeviceFlow(gh, 'CLIENT', 'repo')).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});

describe('pollForToken', () => {
  const session = {
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Date.now() + 60_000,
    deviceCode: 'DEV',
    intervalMs: 0,
  };

  it('keeps waiting while authorization is pending, then returns the token', async () => {
    const calls = mockFetch([
      { body: { error: 'authorization_pending' } },
      { body: { error: 'authorization_pending' } },
      { body: { access_token: 'gho_token', scope: 'repo' } },
    ]);

    const result = await pollForToken(gh, 'CLIENT', session);
    expect(result).toEqual({ token: 'gho_token', scopes: ['repo'] });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.body).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'DEV',
    });
  });

  it('backs off by five seconds when GitHub says slow down', async () => {
    vi.useFakeTimers();
    mockFetch([{ body: { error: 'slow_down' } }, { body: { access_token: 'gho_token' } }]);

    const promise = pollForToken(gh, 'CLIENT', { ...session, expiresAt: Date.now() + 600_000 });
    // First poll is immediate (interval 0); the retry must wait out the backoff.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4999);
    await vi.advanceTimersByTimeAsync(2);

    await expect(promise).resolves.toMatchObject({ token: 'gho_token' });
  });

  it('stops when the user declines', async () => {
    mockFetch([{ body: { error: 'access_denied' } }]);
    await expect(pollForToken(gh, 'CLIENT', session)).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('stops when the code expires server-side', async () => {
    mockFetch([{ body: { error: 'expired_token' } }]);
    await expect(pollForToken(gh, 'CLIENT', session)).rejects.toMatchObject({
      code: 'expired_token',
    });
  });

  it('never polls past its own deadline', async () => {
    const calls = mockFetch([{ body: { error: 'authorization_pending' } }]);
    await expect(
      pollForToken(gh, 'CLIENT', { ...session, expiresAt: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: 'expired_token' });
    expect(calls).toHaveLength(0);
  });

  it('stops immediately when cancelled', async () => {
    mockFetch([{ body: { error: 'authorization_pending' } }]);
    const controller = new AbortController();
    controller.abort();

    await expect(pollForToken(gh, 'CLIENT', session, controller.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});
