/**
 * The content script / options page <-> service worker contract.
 *
 * Everything the UI needs goes through here, because the token lives only in
 * the worker. Requests are request/response; the device flow gets its own
 * long-lived port, since it has to survive several minutes of waiting for the
 * user and a plain message would let the worker idle out mid-flow.
 */

import type {
  ChangedFile,
  FileDiffPayload,
  NewCommentInput,
  PullRequestInfo,
  ReviewThread,
  ViewerInfo,
} from './github';
import type { TokenMetaLike } from './tokenMeta';

export interface PrLocator {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export type Request =
  | { type: 'auth:status'; host: string }
  | { type: 'auth:manual-token'; host: string; token: string }
  | { type: 'auth:disconnect'; host: string }
  | { type: 'hosts:sync' }
  | { type: 'pr:info'; locator: PrLocator }
  | { type: 'pr:files'; locator: PrLocator }
  | { type: 'pr:file-diff'; pullRequest: PullRequestInfo; file: ChangedFile }
  | { type: 'threads:list'; pullRequest: PullRequestInfo; path: string }
  | { type: 'comment:create'; pullRequest: PullRequestInfo; input: NewCommentInput }
  | { type: 'comment:reply'; pullRequest: PullRequestInfo; replyTo: number; body: string }
  | { type: 'comment:update'; pullRequest: PullRequestInfo; databaseId: number; body: string }
  | { type: 'comment:delete'; pullRequest: PullRequestInfo; databaseId: number }
  | { type: 'comment:react'; pullRequest: PullRequestInfo; databaseId: number; content: string }
  | { type: 'thread:resolve'; pullRequest: PullRequestInfo; threadId: string; resolved: boolean };

export interface AuthStatus {
  connected: boolean;
  meta: TokenMetaLike | null;
  viewer: ViewerInfo | null;
  /** Scopes the token is missing for comment writes. */
  missingScopes: string[];
  /** Whether a device flow can be offered for this host. */
  deviceFlowAvailable: boolean;
  /** Set when the stored token exists but could not be verified. */
  problem: string | null;
}

export interface ResponseMap {
  'auth:status': AuthStatus;
  'auth:manual-token': AuthStatus;
  'auth:disconnect': AuthStatus;
  'hosts:sync': null;
  'pr:info': PullRequestInfo;
  'pr:files': ChangedFile[];
  'pr:file-diff': FileDiffPayload;
  'threads:list': ReviewThread[];
  'comment:create': null;
  'comment:reply': null;
  'comment:update': null;
  'comment:delete': null;
  'comment:react': null;
  'thread:resolve': null;
}

export interface ErrorPayload {
  kind: string;
  message: string;
  retryAt?: number;
}

export type Response<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload };

/** Sends a request to the worker and unwraps the result. */
export async function send<K extends Request['type']>(
  request: Extract<Request, { type: K }>,
): Promise<ResponseMap[K]> {
  const response = (await chrome.runtime.sendMessage(request)) as
    Response<ResponseMap[K]> | undefined;

  if (!response) {
    throw new RequestError('network', 'The extension background worker did not respond.');
  }
  if (!response.ok) {
    throw new RequestError(response.error.kind, response.error.message, response.error.retryAt);
  }
  return response.data;
}

export class RequestError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

// --------------------------------------------------------- device-flow port

export const DEVICE_FLOW_PORT = 'mdpd-device-flow';

export type DeviceFlowClientMessage =
  { type: 'start'; host: string; clientId?: string } | { type: 'ping' } | { type: 'cancel' };

export type DeviceFlowWorkerMessage =
  | { type: 'code'; userCode: string; verificationUri: string; expiresAt: number }
  | { type: 'done'; status: AuthStatus }
  | { type: 'error'; message: string };
