/**
 * Rewrites relative references in rendered markdown to absolute URLs.
 *
 * Replaces upstream's `resolveImagePaths`, which ran a regex over the HTML
 * string and joined paths with `path.posix.join` (a Node API, unavailable in a
 * content script). Working on the DOM also means each pane can resolve against
 * its own commit: the left pane against the base sha, the right against head.
 */

export interface UrlBases {
  /** Base for images, video and other raw assets — a raw.githubusercontent URL. */
  asset?: string;
  /** Base for in-repo page links, such as ./other.md — a github.com blob URL. */
  link?: string;
}

function isAbsolute(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function resolve(value: string, base: string | undefined): string | null {
  if (!base) return null;
  const trimmed = value.trim();
  if (!trimmed || isAbsolute(trimmed) || trimmed.startsWith('#')) return null;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

export function resolveRelativeUrls(root: ParentNode, bases: UrlBases): void {
  for (const el of root.querySelectorAll('img[src], video[src], source[src], audio[src]')) {
    const src = el.getAttribute('src');
    if (src === null) continue;
    const resolved = resolve(src, bases.asset);
    if (resolved !== null) el.setAttribute('src', resolved);
  }

  for (const el of root.querySelectorAll('a[href]')) {
    const href = el.getAttribute('href');
    if (href === null) continue;
    const resolved = resolve(href, bases.link);
    if (resolved !== null) el.setAttribute('href', resolved);
    // Rendered content opens outside the overlay; never navigate the host page.
    if (/^https?:/i.test(el.getAttribute('href') ?? '')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
}
