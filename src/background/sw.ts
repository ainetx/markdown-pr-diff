/**
 * Service worker: the only place that holds the GitHub token.
 *
 * Content scripts and the options page ask for data; they never see
 * credentials. Plain request/response covers everything except the device
 * flow, which uses a port so the page can hold the worker alive across the
 * minutes the user spends approving.
 */

import {
  ApiError,
  createReviewComment,
  deleteComment,
  getFileDiff,
  getCommit,
  getPullRequest,
  getPullRequestRange,
  listCommitFiles,
  listPullRequestFiles,
  listPullRequestRangeFiles,
  listComments,
  addReaction,
  replyToComment,
  setThreadResolved,
  updateComment,
} from './api';
import {
  authStatus,
  describeAuthError,
  disconnect,
  runDeviceFlow,
  storeVerifiedToken,
} from './auth';
import { syncEnterpriseScripts } from './hosts';
import { repairOpenTabs, watchTabs } from './injector';
import {
  DEVICE_FLOW_PORT,
  type DeviceFlowClientMessage,
  type DeviceFlowWorkerMessage,
  type ErrorPayload,
  type Request,
  type Response,
} from '@shared/messages';

function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof ApiError) {
    return { kind: error.kind, message: error.message, retryAt: error.retryAt };
  }
  return { kind: 'unknown', message: describeAuthError(error) };
}

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case 'auth:status':
      return authStatus(request.host);
    case 'auth:manual-token':
      return storeVerifiedToken(request.host, request.token.trim(), 'manual');
    case 'auth:disconnect':
      return disconnect(request.host);
    case 'hosts:sync':
      await syncEnterpriseScripts();
      return null;

    case 'pr:info': {
      const { host, owner, repo, number } = request.locator;
      return getPullRequest(host, owner, repo, number);
    }
    case 'pr:files': {
      const { host, owner, repo, number } = request.locator;
      return listPullRequestFiles(host, owner, repo, number);
    }
    case 'pr:range-info': {
      const { host, owner, repo, number, base, head } = request.locator;
      return getPullRequestRange(host, owner, repo, number, base, head);
    }
    case 'pr:range-files': {
      const { host, owner, repo, base, head } = request.locator;
      return listPullRequestRangeFiles(host, owner, repo, base, head);
    }
    case 'commit:info': {
      const { host, owner, repo, sha } = request.locator;
      return getCommit(host, owner, repo, sha);
    }
    case 'commit:files': {
      const { host, owner, repo, sha } = request.locator;
      return listCommitFiles(host, owner, repo, sha);
    }
    case 'pr:file-diff':
      return getFileDiff(request.target, request.file);

    case 'threads:list':
      return listComments(request.target, request.path);

    case 'comment:create':
      await createReviewComment(request.target, request.input);
      return null;
    case 'comment:reply':
      await replyToComment(request.target, request.replyTo, request.body);
      return null;
    case 'comment:update':
      await updateComment(request.target, request.databaseId, request.body);
      return null;
    case 'comment:delete':
      await deleteComment(request.target, request.databaseId);
      return null;
    case 'comment:react':
      await addReaction(request.target, request.databaseId, request.content);
      return null;
    case 'thread:resolve':
      await setThreadResolved(request.target, request.threadId, request.resolved);
      return null;
  }
}

watchTabs();

chrome.runtime.onInstalled.addListener(() => {
  void syncEnterpriseScripts();
  void repairOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
  void syncEnterpriseScripts();
  void repairOpenTabs();
});

// Reloading the extension restarts the worker without either event firing in
// every Chrome build, so the sweep also runs on plain startup.
void repairOpenTabs();

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch((error: unknown) =>
      sendResponse({ ok: false, error: toErrorPayload(error) } satisfies Response<never>),
    );
  // Keeps the message channel open for the async reply.
  return true;
});

// ------------------------------------------------------------- device flow

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DEVICE_FLOW_PORT) return;

  const controller = new AbortController();
  let authTabId: number | undefined;

  const post = (message: DeviceFlowWorkerMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The page went away mid-flow; the abort below handles the rest.
    }
  };

  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((message: DeviceFlowClientMessage) => {
    if (message.type === 'ping') return;
    if (message.type === 'cancel') {
      controller.abort();
      return;
    }

    runDeviceFlow(
      message.host,
      {
        onCode(session) {
          post({ type: 'code', ...session });
          chrome.tabs
            .create({ url: session.verificationUri, active: true })
            .then((tab) => {
              authTabId = tab.id;
            })
            .catch(() => {
              // The user can still open the URL from the options page.
            });
        },
      },
      controller.signal,
    )
      .then((status) => {
        if (authTabId !== undefined) chrome.tabs.remove(authTabId).catch(() => undefined);
        post({ type: 'done', status });
      })
      .catch((error: unknown) => {
        post({ type: 'error', message: describeAuthError(error) });
      });
  });
});
