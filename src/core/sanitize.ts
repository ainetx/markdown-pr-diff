/**
 * HTML sanitization.
 *
 * Everything rendered here is untrusted: markdown file bodies come from a pull
 * request, and comment bodies come from whoever wrote them. markdown-it runs
 * with `html: true` to match GitHub's own tolerance for inline HTML, so the
 * output has to be sanitized before it reaches the DOM.
 */

import DOMPurify, { type Config, type DOMPurify as DOMPurifyInstance } from 'dompurify';

/** Attributes the diff engine itself writes; they must survive sanitization. */
const EXTRA_ATTRS = ['data-line-start', 'data-line-end', 'data-md-diff-pair', 'data-md-diff-kind'];

const CONFIG: Config = {
  ADD_ATTR: EXTRA_ATTRS,
  // GitHub-flavoured markdown output only. Task-list checkboxes are kept —
  // markdown-it already renders them disabled.
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
  FORBID_ATTR: ['srcset', 'formaction', 'ping'],
  ALLOW_DATA_ATTR: true,
};

const instances = new WeakMap<Document, DOMPurifyInstance>();

function purifierFor(doc: Document): DOMPurifyInstance {
  const existing = instances.get(doc);
  if (existing) return existing;
  const view = doc.defaultView;
  if (!view) throw new Error('cannot sanitize against a document with no window');
  const created = DOMPurify(view);
  instances.set(doc, created);
  return created;
}

/** Parses untrusted HTML into a sanitized fragment owned by `doc`. */
export function toSafeFragment(html: string, doc: Document = document): DocumentFragment {
  return purifierFor(doc).sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

/** Sanitized HTML as a string, for callers that need markup rather than nodes. */
export function sanitizeToString(html: string, doc: Document = document): string {
  return purifierFor(doc).sanitize(html, CONFIG);
}
