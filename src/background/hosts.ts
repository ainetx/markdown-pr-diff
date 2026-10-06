/**
 * Content-script registration for GitHub Enterprise hosts.
 *
 * github.com is declared statically in the manifest. Enterprise hosts are
 * added by the user at runtime, so their script registration is dynamic and
 * only ever covers origins the user has actually granted.
 */

import { loadSettings } from '@shared/settings';

const SCRIPT_ID_PREFIX = 'mdpd-ghe-';

function idFor(host: string): string {
  return SCRIPT_ID_PREFIX + host.replace(/[^a-z0-9.-]/gi, '_');
}

export async function grantedOrigins(hosts: string[]): Promise<string[]> {
  const granted: string[] = [];
  for (const host of hosts) {
    const origin = `https://${host}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) granted.push(origin);
  }
  return granted;
}

/**
 * Brings dynamic registrations in line with the configured hosts: registers
 * what is granted, drops what is not.
 */
export async function syncEnterpriseScripts(): Promise<void> {
  const settings = await loadSettings();
  const hosts = settings.enterpriseHosts.map((entry) => entry.host).filter(Boolean);

  const existing = await chrome.scripting.getRegisteredContentScripts();
  const existingIds = new Set(existing.map((script) => script.id));

  const wanted = new Map<string, string>();
  for (const host of hosts) {
    const origin = `https://${host}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) wanted.set(idFor(host), origin);
  }

  const stale = [...existingIds].filter((id) => id.startsWith(SCRIPT_ID_PREFIX) && !wanted.has(id));
  if (stale.length > 0) await chrome.scripting.unregisterContentScripts({ ids: stale });

  const toRegister = [...wanted.entries()]
    .filter(([id]) => !existingIds.has(id))
    .map(([id, origin]) => ({
      id,
      matches: [origin],
      js: ['content.js'],
      runAt: 'document_idle' as const,
    }));

  if (toRegister.length > 0) await chrome.scripting.registerContentScripts(toRegister);
}
