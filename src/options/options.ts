/**
 * Options page: accounts, display preferences, enterprise hosts.
 */

import { DOT_COM } from '@shared/githubHost';
import {
  DEVICE_FLOW_PORT,
  send,
  type AuthStatus,
  type DeviceFlowWorkerMessage,
} from '@shared/messages';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Layout,
  type Settings,
} from '@shared/settings';

const accountList = document.querySelector<HTMLElement>('#account-list')!;
const hostList = document.querySelector<HTMLElement>('#host-list')!;

let settings: Settings = DEFAULT_SETTINGS;

// --------------------------------------------------------------- utilities

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

// ---------------------------------------------------------------- accounts

function configuredHosts(): string[] {
  return [DOT_COM, ...settings.enterpriseHosts.map((entry) => entry.host).filter(Boolean)];
}

async function renderAccounts(): Promise<void> {
  accountList.replaceChildren();
  for (const host of configuredHosts()) {
    const card = el('div', { class: 'account' });
    accountList.appendChild(card);
    void renderAccount(card, host);
  }
}

async function renderAccount(card: HTMLElement, host: string): Promise<void> {
  card.replaceChildren(
    el(
      'div',
      { class: 'account-head' },
      el('span', { class: 'account-host' }, host),
      el('span', { class: 'badge' }, 'checking…'),
    ),
  );

  let status: AuthStatus;
  try {
    status = await send({ type: 'auth:status', host });
  } catch (error) {
    card.replaceChildren(
      el('div', { class: 'account-head' }, el('span', { class: 'account-host' }, host)),
      el('div', { class: 'notice notice-error' }, String(error)),
    );
    return;
  }

  const head = el(
    'div',
    { class: 'account-head' },
    el('span', { class: 'account-host' }, host),
    status.connected
      ? el('span', { class: 'badge badge-on' }, `connected as @${status.viewer?.login ?? '?'}`)
      : el('span', { class: 'badge badge-off' }, 'read-only'),
  );
  card.replaceChildren(head);

  if (status.connected && status.meta) {
    head.appendChild(
      el(
        'span',
        { class: 'badge' },
        `${status.meta.source === 'device-flow' ? 'device flow' : 'manual token'} · ${formatDate(status.meta.obtainedAt)}`,
      ),
    );
    if (status.viewer && status.viewer.scopes.length > 0) {
      head.appendChild(el('span', { class: 'badge' }, status.viewer.scopes.join(', ')));
    }
  }

  if (status.problem) {
    card.appendChild(el('div', { class: 'notice notice-error' }, status.problem));
  }

  if (status.missingScopes.length > 0) {
    card.appendChild(
      el(
        'div',
        { class: 'notice' },
        `This token is missing the ${status.missingScopes.join(', ')} scope, so posting comments will fail. Reconnect, or use a token with the repo scope.`,
      ),
    );
  }

  const actions = el('div', { class: 'row' });
  card.appendChild(actions);

  if (status.connected) {
    const disconnectBtn = el('button', { class: 'btn btn-danger', type: 'button' }, 'Disconnect');
    disconnectBtn.addEventListener('click', async () => {
      disconnectBtn.disabled = true;
      await send({ type: 'auth:disconnect', host });
      void renderAccount(card, host);
    });
    actions.append(
      disconnectBtn,
      el(
        'a',
        { href: `https://${host}/settings/applications`, target: '_blank', rel: 'noopener' },
        'Revoke access on GitHub',
      ),
    );
  } else {
    const connectBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Connect GitHub');
    connectBtn.disabled = !status.deviceFlowAvailable;
    connectBtn.addEventListener('click', () => startDeviceFlow(card, host, connectBtn));
    actions.appendChild(connectBtn);

    if (!status.deviceFlowAvailable) {
      card.appendChild(deviceFlowSetup(host));
    }
  }

  card.appendChild(manualTokenForm(card, host));
}

/** Everything needed to turn the Connect button on, with the links to do it. */
function deviceFlowSetup(host: string): HTMLElement {
  // Open by default: this only renders when the button is already disabled,
  // and hiding the reason behind another click is what made it confusing.
  const details = el('details', { class: 'setup', open: '' });
  details.appendChild(el('summary', {}, 'Why the button is disabled, and how to enable it'));

  const intro = el(
    'p',
    { class: 'muted' },
    'GitHub will only hand a token to an app it knows. Registering one takes a minute and is only ever done once.',
  );

  const steps = el('ol', { class: 'steps' });

  const step1 = el('li');
  step1.append(
    'Open ',
    link(`https://${host}/settings/developers`, 'Developer settings → OAuth Apps'),
    ' and press ',
    el('strong', {}, 'New OAuth App'),
    '.',
  );

  const step2 = el('li');
  step2.append('Fill the form — the values barely matter, but the fields are required:');
  const fields = el('ul', { class: 'fields' });
  fields.append(
    field('Application name', 'Markdown PR Diff'),
    field('Homepage URL', `https://${host}`),
    field('Authorization callback URL', `https://${host}`),
  );
  step2.appendChild(fields);
  step2.appendChild(
    el(
      'p',
      { class: 'muted' },
      'The callback URL is never used by the device flow; GitHub just insists on one.',
    ),
  );

  const step3 = el('li');
  step3.append(
    'On the page of the app you just created, tick ',
    el('strong', {}, 'Enable Device Flow'),
    ' and save. Without it GitHub refuses the whole flow.',
  );

  const step4 = el('li');
  if (host === DOT_COM) {
    step4.append('Copy the ', el('strong', {}, 'Client ID'), ' and rebuild with it:');
    step4.appendChild(commandBlock('VITE_GITHUB_CLIENT_ID=Ov23li… npm run build'));
    step4.appendChild(
      el(
        'p',
        { class: 'muted' },
        'Then press the reload button on this extension in chrome://extensions. The client id is public by design — it is safe to commit.',
      ),
    );
  } else {
    step4.append(
      'Copy the ',
      el('strong', {}, 'Client ID'),
      ' and paste it into this host entry in the GitHub Enterprise section above. No rebuild needed.',
    );
  }

  steps.append(step1, step2, step3, step4);

  const shortcut = el('p', { class: 'muted' });
  shortcut.append(
    'Would rather not register an app? ',
    link(
      `https://${host}/settings/tokens/new?scopes=repo&description=Markdown+PR+Diff`,
      'Create a personal access token with the repo scope',
    ),
    ' and paste it below — everything works the same.',
  );

  details.append(intro, steps, shortcut);
  return details;
}

function link(href: string, text: string): HTMLAnchorElement {
  const anchor = el('a', { href, target: '_blank', rel: 'noopener' }, text);
  return anchor;
}

function field(label: string, value: string): HTMLElement {
  const item = el('li');
  item.append(el('span', { class: 'field-label' }, label), copyableValue(value));
  return item;
}

/** A value with a copy button, so nothing has to be retyped by hand. */
function copyableValue(value: string): HTMLElement {
  const wrap = el('span', { class: 'copyable' });
  const code = el('code', {}, value);
  const button = el('button', { class: 'copy-btn', type: 'button' }, 'Copy');
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(value).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    });
  });
  wrap.append(code, button);
  return wrap;
}

function commandBlock(command: string): HTMLElement {
  const wrap = el('div', { class: 'command' });
  wrap.append(el('code', {}, command), copyButtonFor(command));
  return wrap;
}

function copyButtonFor(value: string): HTMLButtonElement {
  const button = el('button', { class: 'copy-btn', type: 'button' }, 'Copy');
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(value).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    });
  });
  return button;
}

function manualTokenForm(card: HTMLElement, host: string): HTMLElement {
  const details = el('details', { class: 'manual' });
  details.appendChild(el('summary', {}, 'Use a personal access token instead'));

  const help = el('p', { class: 'muted' });
  help.append(
    link(
      `https://${host}/settings/tokens/new?scopes=repo&description=Markdown+PR+Diff`,
      'Create a classic token',
    ),
    ' — the repo scope is already ticked on that page. A fine-grained token works too, with Pull requests: Read and write and Contents: Read.',
  );
  details.appendChild(help);

  const input = el('input', {
    type: 'password',
    placeholder: 'ghp_… (needs the repo scope)',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const saveBtn = el('button', { class: 'btn', type: 'button' }, 'Save token');
  const row = el('div', { class: 'row' }, input, saveBtn);
  details.appendChild(row);

  saveBtn.addEventListener('click', async () => {
    const token = input.value.trim();
    if (!token) return;
    saveBtn.disabled = true;
    try {
      await send({ type: 'auth:manual-token', host, token });
      input.value = '';
      void renderAccount(card, host);
    } catch (error) {
      saveBtn.disabled = false;
      details.appendChild(el('div', { class: 'notice notice-error' }, String(error)));
    }
  });

  return details;
}

function startDeviceFlow(card: HTMLElement, host: string, trigger: HTMLButtonElement): void {
  trigger.disabled = true;

  const panel = el('div', { class: 'notice' }, 'Requesting a device code…');
  card.appendChild(panel);

  const port = chrome.runtime.connect({ name: DEVICE_FLOW_PORT });
  // The worker would otherwise idle out while the user is on the approval page.
  const heartbeat = setInterval(() => port.postMessage({ type: 'ping' }), 20_000);

  const stop = () => {
    clearInterval(heartbeat);
    port.disconnect();
  };

  port.onMessage.addListener((message: DeviceFlowWorkerMessage) => {
    if (message.type === 'code') {
      panel.replaceChildren(
        el('div', {}, 'Approve this code on GitHub. A tab should have opened.'),
        el('div', { class: 'user-code' }, message.userCode),
      );

      const copyBtn = el('button', { class: 'btn', type: 'button' }, 'Copy code');
      copyBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(message.userCode);
        copyBtn.textContent = 'Copied';
      });

      const openLink = el(
        'a',
        { href: message.verificationUri, target: '_blank', rel: 'noopener' },
        'Open the approval page',
      );

      const cancelBtn = el('button', { class: 'btn', type: 'button' }, 'Cancel');
      cancelBtn.addEventListener('click', () => {
        port.postMessage({ type: 'cancel' });
        stop();
        trigger.disabled = false;
        panel.remove();
      });

      panel.appendChild(el('div', { class: 'row' }, copyBtn, openLink, cancelBtn));
      return;
    }

    if (message.type === 'done') {
      stop();
      void renderAccount(card, host);
      return;
    }

    stop();
    trigger.disabled = false;
    panel.className = 'notice notice-error';
    panel.textContent = message.message;
  });

  port.onDisconnect.addListener(() => clearInterval(heartbeat));
  port.postMessage({ type: 'start', host });
}

// ----------------------------------------------------------------- display

function bindDisplay(): void {
  const showButton = document.querySelector<HTMLInputElement>('#showButton')!;
  const layout = document.querySelector<HTMLSelectElement>('#layout')!;
  const showComments = document.querySelector<HTMLInputElement>('#showComments')!;
  const maxSize = document.querySelector<HTMLInputElement>('#maxFileSizeKb')!;

  showButton.checked = settings.showButton;
  layout.value = settings.layout;
  showComments.checked = settings.showComments;
  maxSize.value = String(settings.maxFileSizeKb);

  showButton.addEventListener('change', async () => {
    settings = await saveSettings({ showButton: showButton.checked });
  });
  layout.addEventListener('change', async () => {
    settings = await saveSettings({ layout: layout.value as Layout });
  });
  showComments.addEventListener('change', async () => {
    settings = await saveSettings({ showComments: showComments.checked });
  });
  maxSize.addEventListener('change', async () => {
    const value = Number(maxSize.value);
    if (!Number.isFinite(value) || value < 16) {
      maxSize.value = String(settings.maxFileSizeKb);
      return;
    }
    settings = await saveSettings({ maxFileSizeKb: Math.round(value) });
  });
}

// ------------------------------------------------------------ ghe hosts

function renderHosts(): void {
  hostList.replaceChildren();
  for (const entry of settings.enterpriseHosts) {
    const removeBtn = el('button', { class: 'btn btn-danger', type: 'button' }, 'Remove');
    removeBtn.addEventListener('click', async () => {
      settings = await saveSettings({
        enterpriseHosts: settings.enterpriseHosts.filter((h) => h.host !== entry.host),
      });
      await chrome.permissions.remove({ origins: [`https://${entry.host}/*`] });
      await send({ type: 'hosts:sync' });
      renderHosts();
      void renderAccounts();
    });

    hostList.appendChild(
      el(
        'div',
        { class: 'row' },
        el('strong', {}, entry.host),
        el('span', { class: 'badge' }, entry.clientId ? 'device flow configured' : 'token only'),
        removeBtn,
      ),
    );
  }
}

function bindAddHost(): void {
  const form = document.querySelector<HTMLFormElement>('#add-host')!;
  const hostInput = document.querySelector<HTMLInputElement>('#host-input')!;
  const clientIdInput = document.querySelector<HTMLInputElement>('#host-client-id')!;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const host = hostInput.value
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!host) return;

    // Host permission must be requested from a user gesture, which this is.
    const granted = await chrome.permissions.request({ origins: [`https://${host}/*`] });
    if (!granted) {
      form.appendChild(
        el('div', { class: 'notice notice-error' }, `Permission for ${host} was declined.`),
      );
      return;
    }

    settings = await saveSettings({
      enterpriseHosts: [
        ...settings.enterpriseHosts.filter((h) => h.host !== host),
        { host, clientId: clientIdInput.value.trim() },
      ],
    });
    await send({ type: 'hosts:sync' });

    hostInput.value = '';
    clientIdInput.value = '';
    renderHosts();
    void renderAccounts();
  });
}

// -------------------------------------------------------------------- init

async function main(): Promise<void> {
  settings = await loadSettings();
  bindDisplay();
  bindAddHost();
  renderHosts();
  await renderAccounts();
}

void main();
