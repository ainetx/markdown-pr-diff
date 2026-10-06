/**
 * Unsent comment text survives closing the overlay.
 *
 * Losing a half-written review comment because a dialog closed is the kind of
 * small betrayal that stops people trusting a tool, so drafts are persisted
 * the moment they are typed and cleared only once the comment is accepted.
 */

const PREFIX = 'draft:';

export interface DraftKey {
  host: string;
  owner: string;
  repo: string;
  number: number;
  path: string;
  /** Thread id for a reply, or `new:<side>:<line>` for a fresh comment. */
  slot: string;
}

function keyOf(key: DraftKey): string {
  return `${PREFIX}${key.host}/${key.owner}/${key.repo}/${key.number}/${key.path}#${key.slot}`;
}

export async function readDraft(key: DraftKey): Promise<string> {
  const stored = await chrome.storage.local.get(keyOf(key));
  return (stored[keyOf(key)] as string | undefined) ?? '';
}

export async function writeDraft(key: DraftKey, body: string): Promise<void> {
  if (body.trim() === '') {
    await clearDraft(key);
    return;
  }
  await chrome.storage.local.set({ [keyOf(key)]: body });
}

export async function clearDraft(key: DraftKey): Promise<void> {
  await chrome.storage.local.remove(keyOf(key));
}
