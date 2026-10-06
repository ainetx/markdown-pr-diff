/**
 * markdown-it plugin that stamps source line numbers onto block elements.
 *
 * This is what lets us render each version of the document in a single pass —
 * so tables, lists and fenced code come out structurally correct — and still
 * know which rendered element covers which source lines. The same map is reused
 * to anchor review comments, which GitHub addresses by (side, line).
 *
 * Nested blocks are stamped too, not just top-level ones. That is what lets a
 * changed table row highlight as a row and a changed list item as an item,
 * instead of lighting up the whole table or list.
 *
 * markdown-it's `token.map` is `[startLine, endLineExclusive]`, 0-based. We
 * publish 1-based inclusive bounds to match GitHub's line numbering.
 */

import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

type Plugin = (md: MarkdownIt) => void;

export const LINE_START_ATTR = 'data-line-start';
export const LINE_END_ATTR = 'data-line-end';

/** Tokens rendered by rules that ignore `token.attrs` need the attrs inlined by hand. */
export function lineAttrsOf(token: Token): string {
  const start = token.attrGet(LINE_START_ATTR);
  const end = token.attrGet(LINE_END_ATTR);
  if (start === null || end === null) return '';
  return ` ${LINE_START_ATTR}="${start}" ${LINE_END_ATTR}="${end}"`;
}

export function readLineRange(el: Element): { start: number; end: number } | null {
  const start = Number(el.getAttribute(LINE_START_ATTR));
  const end = Number(el.getAttribute(LINE_END_ATTR));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return { start, end };
}

export const lineMapPlugin: Plugin = (md) => {
  md.core.ruler.push('md_pr_diff_line_map', (state) => {
    for (const token of state.tokens) {
      if (!token.map) continue;
      // Closing tags carry no attributes of their own.
      if (token.nesting === -1) continue;
      // `inline` is a container for the inline stream, not an element.
      if (token.type === 'inline') continue;
      // Hidden tokens (paragraphs inside tight lists) render to nothing.
      if (token.hidden) continue;

      const [startLine, endLineExclusive] = token.map;
      token.attrSet(LINE_START_ATTR, String(startLine + 1));
      token.attrSet(LINE_END_ATTR, String(Math.max(startLine + 1, endLineExclusive)));
    }
    return true;
  });
};
