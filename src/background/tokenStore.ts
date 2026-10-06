/**
 * Token storage.
 *
 * What this actually protects against, stated plainly: the ciphertext in
 * chrome.storage.local is useless on its own, so copying the browser profile
 * or reading the extension's storage does not hand anyone a working token. The
 * AES key is generated non-extractable, so even code with IndexedDB access
 * cannot read the key material out.
 *
 * What it does not protect against: code running as this extension. Such code
 * can simply ask for a decryption. Treat "encrypted at rest" as exactly that,
 * and nothing more.
 *
 * The token only ever exists inside the service worker. It is never sent to a
 * content script, never put in a message response, and never logged.
 */

import { forgetViewer } from './viewerCache';

const DB_NAME = 'mdpd-keys';
const DB_STORE = 'keys';
const MASTER_KEY = 'master';

const CIPHER_PREFIX = 'token:';
const META_PREFIX = 'token-meta:';
const SESSION_PREFIX = 'token-plain:';

import type { TokenMetaLike } from '@shared/tokenMeta';

export type TokenSource = TokenMetaLike['source'];
export type TokenMeta = TokenMetaLike;

interface Envelope {
  iv: string;
  data: string;
}

// ------------------------------------------------------------------ base64

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

// ------------------------------------------------------------- key storage

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('cannot open key database'));
  });
}

function idbRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const request = run(tx.objectStore(DB_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('key database request failed'));
  });
}

let keyPromise: Promise<CryptoKey> | null = null;

async function masterKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const db = await openDb();
    try {
      const existing = await idbRequest<CryptoKey | undefined>(db, 'readonly', (store) =>
        store.get(MASTER_KEY),
      );
      if (existing) return existing;

      // `false` makes the key non-extractable: it can encrypt and decrypt, but
      // its bytes can never be read back out, not even by us.
      const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await idbRequest(db, 'readwrite', (store) => store.put(created, MASTER_KEY));
      return created;
    } finally {
      db.close();
    }
  })();
  return keyPromise;
}

/** Drops the key so the next access generates a fresh one. Used when clearing. */
async function destroyMasterKey(): Promise<void> {
  keyPromise = null;
  const db = await openDb();
  try {
    await idbRequest(db, 'readwrite', (store) => store.delete(MASTER_KEY));
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- the store

const memory = new Map<string, string>();

async function ensureSessionIsolated(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Already the default on every supported Chrome; nothing to do if the
    // call is unavailable.
  }
}

export async function setToken(
  host: string,
  token: string,
  meta: Omit<TokenMeta, 'host' | 'obtainedAt'>,
): Promise<TokenMeta> {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token),
  );

  const envelope: Envelope = { iv: toBase64(iv), data: toBase64(ciphertext) };
  const stored: TokenMeta = { ...meta, host, obtainedAt: Date.now() };

  await chrome.storage.local.set({
    [CIPHER_PREFIX + host]: envelope,
    [META_PREFIX + host]: stored,
  });

  memory.set(host, token);
  await ensureSessionIsolated();
  await chrome.storage.session.set({ [SESSION_PREFIX + host]: token });

  return stored;
}

export async function getToken(host: string): Promise<string | null> {
  const cached = memory.get(host);
  if (cached) return cached;

  await ensureSessionIsolated();
  const session = await chrome.storage.session.get(SESSION_PREFIX + host);
  const fromSession = session[SESSION_PREFIX + host] as string | undefined;
  if (fromSession) {
    memory.set(host, fromSession);
    return fromSession;
  }

  const local = await chrome.storage.local.get(CIPHER_PREFIX + host);
  const envelope = local[CIPHER_PREFIX + host] as Envelope | undefined;
  if (!envelope) return null;

  try {
    const key = await masterKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data),
    );
    const token = new TextDecoder().decode(plaintext);
    memory.set(host, token);
    await chrome.storage.session.set({ [SESSION_PREFIX + host]: token });
    return token;
  } catch {
    // The key is gone or the blob is corrupt — the stored token can never be
    // recovered, so drop it and make the user reconnect rather than failing
    // every request from here on.
    await clearToken(host);
    return null;
  }
}

export async function getTokenMeta(host: string): Promise<TokenMeta | null> {
  const stored = await chrome.storage.local.get(META_PREFIX + host);
  return (stored[META_PREFIX + host] as TokenMeta | undefined) ?? null;
}

export async function clearToken(host: string): Promise<void> {
  memory.delete(host);
  await chrome.storage.local.remove([CIPHER_PREFIX + host, META_PREFIX + host]);
  await chrome.storage.session.remove(SESSION_PREFIX + host);
  // Here rather than at the call sites: whoever adds the next way to drop a
  // token should not have to know that an identity was cached alongside it.
  await forgetViewer(host);

  // Once no host has a token left, throw the key away too.
  const remaining = await chrome.storage.local.get(null);
  const stillStored = Object.keys(remaining).some((k) => k.startsWith(CIPHER_PREFIX));
  if (!stillStored) await destroyMasterKey();
}

export async function listTokenMeta(): Promise<TokenMeta[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(META_PREFIX))
    .map(([, value]) => value as TokenMeta);
}
