/**
 * Markdown -> HTML, with source line numbers attached to every top-level block.
 *
 * Adapted from markdown-diff-visualiser's src/markdownRenderer.ts (MIT, see
 * NOTICE). Changes from upstream:
 *   - the line-map plugin is installed, and the fence / code_block / html_block
 *     rules are overridden so their line attributes survive rendering;
 *   - URL resolution moved out to resolveUrls.ts, which rewrites a real DOM
 *     instead of running regexes over an HTML string.
 */

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import diffLang from 'highlight.js/lib/languages/diff';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import shell from 'highlight.js/lib/languages/shell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

import { githubAlertsPlugin } from './githubFlavour';
import { lineAttrsOf, lineMapPlugin } from './lineMap';

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  python,
  py: python,
  bash,
  sh: bash,
  json,
  yaml,
  yml: yaml,
  sql,
  css,
  xml,
  html: xml,
  markdown,
  md: markdown,
  diff: diffLang,
  java,
  csharp,
  cs: csharp,
  go,
  rust,
  rs: rust,
  ruby,
  rb: ruby,
  php,
  shell,
  dockerfile,
  docker: dockerfile,
};

let languagesRegistered = false;
function registerLanguages(): void {
  if (languagesRegistered) return;
  for (const [name, language] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, language);
  }
  languagesRegistered = true;
}

export interface RendererOptions {
  /** Autolink bare URLs, as GitHub does. Defaults to true. */
  linkify?: boolean;
}

export interface MarkdownRenderer {
  render(markdown: string): string;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Whether a raw HTML fragment opens and closes everything it starts.
 *
 * Only such a fragment can safely be wrapped; anything else is one half of a
 * structure whose other half lives in a different token.
 */
function isSelfContained(html: string): boolean {
  const stack: string[] = [];
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [, closing, rawName, selfClosing] = match;
    const name = rawName!.toLowerCase();
    if (VOID_TAGS.has(name) || selfClosing === '/') continue;
    if (closing === '/') {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** Highlighted inner HTML for a code body; falls back to escaped text. */
function highlightBody(md: MarkdownIt, code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // Unusable grammar for this input — fall through to plain escaping.
    }
  }
  return md.utils.escapeHtml(code);
}

export function createRenderer(options?: RendererOptions): MarkdownRenderer {
  registerLanguages();

  const md = new MarkdownIt({
    html: true,
    linkify: options?.linkify !== false,
    // Upstream enabled markdown-it's typographer along with linkify. GitHub
    // does not do typographic replacement, so leaving it on would render
    // straight quotes as curly ones and show phantom differences against the
    // text the reviewer actually sees on the pull request.
    typographer: false,
    breaks: false,
  });

  md.use(githubAlertsPlugin);
  md.use(lineMapPlugin);
  md.use(taskLists, { enabled: false });
  md.use(footnote);

  // The default fence renderer puts attributes on <code> and drops them
  // entirely when `highlight` returns a full <pre>. We need them on the
  // top-level element, so the rule is ours.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    const body = highlightBody(md, token.content, lang);
    const langClass = lang ? ` ${md.utils.escapeHtml(`language-${lang}`)}` : '';
    return `<pre class="hljs"${lineAttrsOf(token)}><code class="hljs${langClass}">${body}</code></pre>\n`;
  };

  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx]!;
    const body = md.utils.escapeHtml(token.content);
    return `<pre class="hljs"${lineAttrsOf(token)}><code>${body}</code></pre>\n`;
  };

  // Raw HTML blocks are emitted verbatim, so there is no element of ours to
  // carry the line range. Wrapping one creates that element — but only when
  // the block stands on its own.
  //
  // The case that matters: GitHub's collapsible sections are written as
  //
  //     <details>
  //     <summary>…</summary>
  //
  //     markdown in between
  //
  //     </details>
  //
  // which markdown-it splits into two separate html_block tokens. Wrapping
  // each half in a div breaks the nesting, the parser closes <details> early,
  // and the body spills out below an empty, permanently collapsed triangle.
  // So an unbalanced fragment is emitted untouched and simply goes
  // unclassified, which costs a highlight rather than the whole document.
  md.renderer.rules.html_block = (tokens, idx) => {
    const token = tokens[idx]!;
    const attrs = lineAttrsOf(token);
    if (!attrs || !isSelfContained(token.content)) return token.content;
    return `<div class="md-raw-html"${attrs}>${token.content}</div>\n`;
  };

  return {
    render(source: string): string {
      if (!source) return '';
      return md.render(source);
    },
  };
}
