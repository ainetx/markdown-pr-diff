/**
 * Finding the per-file blocks on a pull request's changed-files page.
 *
 * This is the extension's only dependency on GitHub's markup, and the part
 * most likely to rot: the React diff view names its classes with hashed CSS
 * modules that change without warning. So nothing here matches on those names
 * alone. The primary strategy keys on the one thing every file header must
 * have and must keep — the file path itself, next to the control that copies
 * it — and the button is inserted beside that path.
 *
 * Every lookup is allowed to fail. When a file block cannot be identified we
 * simply add no button; the page is never modified in any other way.
 */

export interface FileBlock {
  /** Row the file path lives in; used to tell whether a button is already there. */
  header: HTMLElement;
  /** The element showing the path. */
  anchor: HTMLElement;
  /**
   * Where the button goes: after this element.
   *
   * Not simply after the path. GitHub truncates long file names inside a
   * clipping container, and a button placed in there is cut off with the
   * name — present in the DOM, invisible on screen. This is the outermost
   * clipping ancestor within the header, so the button lands beyond it.
   */
  insertAfter: HTMLElement;
  path: string;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path.trim());
}

/**
 * Directionality marks wrap the path GitHub renders, and they are not
 * whitespace, so `trim` leaves them in place and every later comparison — the
 * regex here, the lookup against the API's file list — silently fails.
 */
const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(BIDI_MARKS, '').trim().replace(/^\/+/, '');
}

/** Our own button carries the path in its tooltip; it must not seed a scan. */
function isOurs(el: Element): boolean {
  return el.closest('[class^="mdpd-"], [class*=" mdpd-"]') !== null;
}

/** Sidebars and file trees also list file names; they are not file headers. */
function insideNavigation(el: Element): boolean {
  return el.closest('nav, [role="tree"], [role="navigation"], [aria-label*="tree" i]') !== null;
}

/**
 * The diff body mentions file names in its content; those are not headers.
 *
 * Note what is deliberately absent: `code`. GitHub sets the file path in a
 * monospace element, so excluding `code` threw away the very thing being
 * looked for. Code inside the diff body is already caught by the table and
 * pre selectors.
 */
function insideDiffBody(el: Element): boolean {
  return el.closest('table, pre, [data-line-number], .blob-code, .diff-table') !== null;
}

/**
 * Overflow menus repeat the path in items like "Copy path". Anchoring there
 * would bury the button inside a dropdown instead of putting it beside the
 * file name.
 */
function insideMenu(el: Element): boolean {
  return (
    el.closest(
      '[role="menu"], [role="menuitem"], [role="listbox"], [role="dialog"], dialog, details-menu, action-menu, [popover], .dropdown-menu, .ActionListWrap',
    ) !== null
  );
}

const PATH_TEXT = /^[\w@][\w./@+-]*\.(md|markdown|mdx)$/i;

/**
 * The file name as plain text.
 *
 * The React diff view renders the path as a bare text node — no title, no
 * copy-control attribute — so this is the only thing that reliably finds it.
 * Guarded on both sides: text inside the diff body is content, not a heading,
 * and text inside a sidebar is the file tree.
 */
function textPathCandidates(root: ParentNode): { el: HTMLElement; path: string }[] {
  const doc = (root as Document).createTreeWalker ? (root as Document) : document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const found: { el: HTMLElement; path: string }[] = [];

  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = normalize(node.data);
    const el = node.parentElement;
    node = walker.nextNode() as Text | null;

    if (!el || !PATH_TEXT.test(text)) continue;
    if (isOurs(el) || insideNavigation(el) || insideDiffBody(el) || insideMenu(el)) continue;
    found.push({ el, path: text });
  }

  return found;
}

/**
 * Candidate path carriers, most reliable first:
 *   - the copy-path control GitHub renders beside every file name;
 *   - an element whose title is the path;
 *   - the "view file" link, whose href ends in the path.
 */
function pathCandidates(root: ParentNode): { el: HTMLElement; path: string }[] {
  const found: { el: HTMLElement; path: string }[] = [];

  const push = (el: Element | null | undefined, raw: string | null | undefined) => {
    if (!el) return;
    const path = normalize(raw);
    // A bare path only. Tooltips and headings mention file names inside whole
    // sentences, and treating those as paths invents files that do not exist.
    if (!PATH_TEXT.test(path)) return;
    if (isOurs(el) || insideNavigation(el) || insideMenu(el) || insideDiffBody(el)) return;
    found.push({ el: el as HTMLElement, path });
  };

  for (const el of root.querySelectorAll('clipboard-copy[value], [data-clipboard-text]')) {
    push(el, el.getAttribute('value') ?? el.getAttribute('data-clipboard-text'));
  }

  for (const el of root.querySelectorAll('[title]')) {
    push(el, el.getAttribute('title'));
  }

  for (const el of root.querySelectorAll('[data-tagsearch-path], [data-path]')) {
    push(el, el.getAttribute('data-tagsearch-path') ?? el.getAttribute('data-path'));
  }

  for (const el of root.querySelectorAll('a[href*="/blob/"]')) {
    const match = /\/blob\/[^/]+\/(.+?)(?:[?#]|$)/.exec(el.getAttribute('href') ?? '');
    if (match?.[1]) push(el, decodeURIComponent(match[1]));
  }

  found.push(...textPathCandidates(root));

  return found;
}

/** Whether an element hides what overflows it, by clipping or by ellipsis. */
function clipsContent(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.textOverflow === 'ellipsis') return true;
  return [style.overflow, style.overflowX].some(
    (value) => value === 'hidden' || value === 'clip' || value === 'auto' || value === 'scroll',
  );
}

/**
 * The last element on the way up to the header that clips its content.
 *
 * Anything placed inside such an element shares the fate of the truncated
 * file name, so the button is inserted after it instead.
 */
function escapeClipping(carrier: HTMLElement, header: HTMLElement): HTMLElement {
  let node: HTMLElement = carrier;
  let outermost: HTMLElement = carrier;

  while (node !== header && node.parentElement && node.parentElement !== header.parentElement) {
    if (clipsContent(node)) outermost = node;
    if (node.parentElement === header) break;
    node = node.parentElement;
  }

  return outermost;
}

/**
 * The row that shows the file path. Walks up from the path carrier until the
 * element is wide enough to be a header row rather than the label itself,
 * which avoids depending on any class name.
 */
function headerRowFor(carrier: HTMLElement): HTMLElement {
  let node: HTMLElement = carrier;
  for (let depth = 0; depth < 4; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    // Stop before escaping into the element that holds the diff body itself.
    if (parent.querySelector('table, [data-line-number], .blob-code, pre')) break;
    node = parent;
  }
  return node;
}

/** Orders candidates the way they appear in the document. */
function inDocumentOrder(
  candidates: { el: HTMLElement; path: string }[],
): { el: HTMLElement; path: string }[] {
  return [...candidates].sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/**
 * One block per markdown file, anchored to the first place its path appears.
 *
 * Deduplicating by path rather than by header matters: GitHub repeats the path
 * in the file's overflow menu, and a menu is rendered after the header it
 * belongs to. Taking the earliest occurrence keeps the button beside the file
 * name even if a future menu shape slips past the menu check.
 */
export function findMarkdownFileBlocks(root: ParentNode = document): FileBlock[] {
  const byPath = new Map<string, FileBlock>();

  for (const { el, path } of inDocumentOrder(pathCandidates(root))) {
    if (byPath.has(path)) continue;
    const header = headerRowFor(el);
    byPath.set(path, { header, anchor: el, insertAfter: escapeClipping(el, header), path });
  }

  // A truncated label and the full path denote the same file; keep the full one.
  for (const [path, block] of [...byPath]) {
    const fuller = [...byPath.keys()].find((other) => other !== path && other.endsWith(`/${path}`));
    if (fuller && byPath.get(fuller)!.header === block.header) byPath.delete(path);
  }

  return [...byPath.values()];
}

export function isPullRequestFilesPage(url: string = location.href): boolean {
  return /\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/.test(url);
}

// ------------------------------------------------------------- diagnostics

export interface PageSample {
  text: string;
  inNavigation: boolean;
  /** Null when this mention was accepted as a file path. */
  rejectedBy: string | null;
  ancestors: string[];
  html: string;
}

export interface LocateReport {
  url: string;
  isFilesPage: boolean;
  candidates: { path: string; carrier: string; headerTag: string }[];
  blocks: { path: string; headerOuterHtml: string }[];
  /** Raw markup around markdown mentions, for when the selectors find nothing. */
  samples: PageSample[];
}

/**
 * A description of what the selectors did and did not find on this page.
 * Exists so that a layout change can be reported precisely instead of as
 * "the button is missing".
 */
export function describePage(root: ParentNode = document): LocateReport {
  const candidates = pathCandidates(root).map(({ el, path }) => ({
    path,
    carrier: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''}`,
    headerTag: headerRowFor(el).tagName.toLowerCase(),
  }));

  const blocks = findMarkdownFileBlocks(root).map((block) => ({
    path: block.path,
    headerOuterHtml: block.header.outerHTML.slice(0, 4000),
  }));

  return {
    url: location.href,
    isFilesPage: isPullRequestFilesPage(),
    candidates,
    blocks,
    samples: markdownMentions(root),
  };
}

/**
 * Raw markup around every mention of a markdown file name.
 *
 * A report saying only "found nothing" cannot be acted on. When the selectors
 * come up empty this is what makes the actual shape of the page visible, so it
 * can be fixed in one round rather than by guessing.
 */
function markdownMentions(root: ParentNode): PageSample[] {
  const doc = (root as Document).createTreeWalker ? (root as Document) : document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const samples: PageSample[] = [];

  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = normalize(node.data);
    const el = node.parentElement;
    node = walker.nextNode() as Text | null;

    if (!el || !/\.(md|markdown|mdx)\b/i.test(text)) continue;
    // Page and document titles mention the file too and crowd out the header.
    if (el.closest('head, title')) continue;
    // Prose that merely mentions a file is noise; a path label is short.
    if (text.length > 120) continue;

    const ancestors: string[] = [];
    let walk: HTMLElement | null = el;
    for (let depth = 0; depth < 7 && walk; depth++) {
      ancestors.push(describeElement(walk));
      walk = walk.parentElement;
    }

    samples.push({
      text,
      inNavigation: insideNavigation(el),
      rejectedBy: rejectionReason(el, text),
      ancestors,
      html: (el.parentElement?.parentElement ?? el).outerHTML.slice(0, 2500),
    });
    if (samples.length >= 12) break;
  }

  // Path-shaped labels first: those are the ones a header would use.
  return samples.sort((a, b) => Number(PATH_TEXT.test(b.text)) - Number(PATH_TEXT.test(a.text)));
}

/** Why a mention was not taken as a file path — the first question to ask. */
function rejectionReason(el: Element, text: string): string | null {
  if (!PATH_TEXT.test(text)) return 'text is not a bare path';
  if (isOurs(el)) return 'our own injected element';
  if (insideNavigation(el)) return 'inside navigation';
  if (insideMenu(el)) return 'inside a menu';
  if (insideDiffBody(el)) return 'inside the diff body';
  return null;
}

function describeElement(el: Element): string {
  const attrs = ['id', 'role', 'aria-label', 'data-testid']
    .map((name) => (el.hasAttribute(name) ? `${name}="${el.getAttribute(name)}"` : ''))
    .filter(Boolean)
    .join(' ');
  const cls = typeof el.className === 'string' && el.className ? ` class="${el.className}"` : '';
  return `<${el.tagName.toLowerCase()}${cls}${attrs ? ' ' + attrs : ''}>`;
}
