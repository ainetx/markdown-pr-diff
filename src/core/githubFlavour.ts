/**
 * The parts of GitHub's markdown that plain markdown-it does not cover.
 *
 * Alerts and cross-references are everywhere in pull request comments, and a
 * reviewer reading them here should see what they would see on GitHub.
 */

import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';

type Plugin = (md: MarkdownIt) => void;

const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n?/i;

/**
 * GitHub alerts: a blockquote whose first line is `[!NOTE]` and friends.
 * Rendered as a styled callout rather than a quote with a stray marker.
 */
export const githubAlertsPlugin: Plugin = (md) => {
  md.core.ruler.push('github_alerts', (state: StateCore) => {
    const { tokens } = state;

    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i]!.type !== 'blockquote_open') continue;
      if (tokens[i + 1]!.type !== 'paragraph_open') continue;

      const inline = tokens[i + 2]!;
      if (inline.type !== 'inline') continue;

      const match = ALERT_MARKER.exec(inline.content);
      if (!match) continue;

      const kind = match[1]!.toLowerCase();
      const rest = inline.content.slice(match[0].length);

      // Re-parse what is left so the body keeps its own inline markup.
      inline.content = rest;
      inline.children = [];
      state.md.inline.parse(rest, state.md, state.env, inline.children);

      const blockquote = tokens[i]!;
      blockquote.attrJoin('class', `markdown-alert markdown-alert-${kind}`);

      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="markdown-alert-title">${ALERT_TITLES[kind]}</p>\n`;
      tokens.splice(i + 1, 0, title);
      i += 1;
    }

    return true;
  });
};

export interface ReferenceContext {
  /** Web host, e.g. github.com. */
  host: string;
  owner: string;
  repo: string;
}

const MENTION = /(^|[^\w/])@([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})\b/g;
const ISSUE = /(^|[^\w/])(?:([\w.-]+)\/([\w.-]+))?#(\d{1,9})\b/g;

/** Elements whose text is not prose and must be left alone. */
const SKIP = 'a, code, pre, kbd, samp, .mdpd-composer';

/**
 * Turns `@user` and `#123` into links, the way GitHub does.
 *
 * Commit hashes are deliberately not linked: GitHub only links the ones it
 * knows are commits, and guessing from bare hex would turn ordinary words and
 * ids into broken links.
 */
export function linkGitHubReferences(root: ParentNode, context: ReferenceContext): void {
  const doc = (root as Element).ownerDocument ?? document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];

  let node = walker.nextNode() as Text | null;
  while (node) {
    const current = node;
    node = walker.nextNode() as Text | null;
    if (!current.parentElement || current.parentElement.closest(SKIP)) continue;
    if (!/[@#]/.test(current.data)) continue;
    targets.push(current);
  }

  for (const text of targets) replaceReferences(text, context, doc);
}

interface Replacement {
  start: number;
  end: number;
  href: string;
  label: string;
}

function collect(data: string, context: ReferenceContext): Replacement[] {
  const base = `https://${context.host}`;
  const found: Replacement[] = [];

  for (const match of data.matchAll(MENTION)) {
    const lead = match[1]!.length;
    const start = match.index! + lead;
    found.push({
      start,
      end: start + 1 + match[2]!.length,
      href: `${base}/${match[2]}`,
      label: `@${match[2]}`,
    });
  }

  for (const match of data.matchAll(ISSUE)) {
    const lead = match[1]!.length;
    const start = match.index! + lead;
    const owner = match[2] ?? context.owner;
    const repo = match[3] ?? context.repo;
    const label = match[2] ? `${match[2]}/${match[3]}#${match[4]}` : `#${match[4]}`;
    found.push({
      start,
      end: start + label.length,
      href: `${base}/${owner}/${repo}/issues/${match[4]}`,
      label,
    });
  }

  // Overlapping matches cannot both be applied; earliest wins.
  found.sort((a, b) => a.start - b.start);
  const kept: Replacement[] = [];
  let cursor = 0;
  for (const item of found) {
    if (item.start < cursor) continue;
    kept.push(item);
    cursor = item.end;
  }
  return kept;
}

function replaceReferences(text: Text, context: ReferenceContext, doc: Document): void {
  const replacements = collect(text.data, context);
  if (replacements.length === 0) return;

  const fragment = doc.createDocumentFragment();
  let cursor = 0;

  for (const item of replacements) {
    if (item.start > cursor) {
      fragment.appendChild(doc.createTextNode(text.data.slice(cursor, item.start)));
    }
    const anchor = doc.createElement('a');
    anchor.href = item.href;
    anchor.textContent = item.label;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    fragment.appendChild(anchor);
    cursor = item.end;
  }

  if (cursor < text.data.length) {
    fragment.appendChild(doc.createTextNode(text.data.slice(cursor)));
  }

  text.replaceWith(fragment);
}
