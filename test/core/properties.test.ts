import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeWordDiff,
  applyWordDiff,
  ADDED_WORD_CLASS,
  REMOVED_WORD_CLASS,
} from '@core/wordDiff';
import { computeDocumentDiff } from '@core/blockDiff';
import { buildLineMapping } from '@core/lineMapping';
import { panesOf, renderStandalone, stripDiffMarks } from './structuralIntegrity';

/** Block templates that, mixed together, exercise every renderer path. */
const blockArb = fc.oneof(
  fc.constantFrom('# Heading', '## Sub heading', '### Deeper'),
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.&<>"'-]{0,60}$/),
  fc.constantFrom('- item', '- another item', '1. first', '2. second'),
  fc.constantFrom('| a | b |', '| --- | --- |', '| 1 | 2 |'),
  fc.constantFrom('```ts', 'const x = 1;', '```', '> quoted', '---', ''),
);

const docArb = fc.array(blockArb, { minLength: 0, maxLength: 25 }).map((rows) => rows.join('\n'));

describe('rendering invariants', () => {
  it('each side of a diff renders exactly as that document renders alone', () => {
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const { before: oldPane, after: newPane } = panesOf(before, after);
        expect(stripDiffMarks(oldPane)).toBe(renderStandalone(before));
        expect(stripDiffMarks(newPane)).toBe(renderStandalone(after));
      }),
      { numRuns: 120 },
    );
  });

  it('never marks an element that wraps another marked element', () => {
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const { before: oldPane, after: newPane } = panesOf(before, after);
        for (const pane of [oldPane, newPane]) {
          const marked = [...pane.querySelectorAll('.diff-added-block, .diff-removed-block')];
          for (const el of marked) {
            expect(marked.some((other) => other !== el && el.contains(other))).toBe(false);
          }
        }
      }),
      { numRuns: 80 },
    );
  });

  it('marks nothing when the two documents are identical', () => {
    fc.assert(
      fc.property(docArb, (text) => {
        const { before: oldPane, after: newPane, result } = panesOf(text, text);
        expect(result.diff.unchanged).toBe(true);
        expect(oldPane.querySelectorAll('.diff-removed-block')).toHaveLength(0);
        expect(newPane.querySelectorAll('.diff-added-block')).toHaveLength(0);
      }),
      { numRuns: 60 },
    );
  });
});

describe('computeDocumentDiff invariants', () => {
  it('produces regions in ascending, non-overlapping order on each side', () => {
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const { regions } = computeDocumentDiff(before, after);
        for (const side of ['old', 'new'] as const) {
          const ranges = regions.map((r) => r[side]).filter((r) => r !== null);
          for (let i = 1; i < ranges.length; i++) {
            expect(ranges[i]!.start).toBeGreaterThan(ranges[i - 1]!.end);
          }
          for (const range of ranges) expect(range.end).toBeGreaterThanOrEqual(range.start);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('maps every unchanged line to a line with identical content', () => {
    // The strongest statement of what the mapping means. It is what lines the
    // two panes up, so an off-by-one here shows as visibly skewed panes.
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const oldLines = before.split('\n');
        const newLines = after.split('\n');
        const diff = computeDocumentDiff(before, after);
        const mapping = buildLineMapping(diff.regions, diff.oldLineCount);

        for (let line = 1; line <= diff.oldLineCount; line++) {
          const mapped = mapping.toNew(line);
          if (mapped === null) continue;
          expect(mapped).toBeGreaterThanOrEqual(1);
          expect(mapped).toBeLessThanOrEqual(newLines.length);
          expect(newLines[mapped - 1]).toBe(oldLines[line - 1]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('keeps the mapping strictly increasing', () => {
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const diff = computeDocumentDiff(before, after);
        const mapping = buildLineMapping(diff.regions, diff.oldLineCount);
        let previous = 0;
        for (let line = 1; line <= diff.oldLineCount; line++) {
          const mapped = mapping.toNew(line);
          if (mapped === null) continue;
          expect(mapped).toBeGreaterThan(previous);
          previous = mapped;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('never maps a changed line to a counterpart', () => {
    fc.assert(
      fc.property(docArb, docArb, (before, after) => {
        const diff = computeDocumentDiff(before, after);
        const mapping = buildLineMapping(diff.regions, diff.oldLineCount);
        for (const region of diff.regions) {
          if (!region.old) continue;
          for (let line = region.old.start; line <= region.old.end; line++) {
            expect(mapping.toNew(line)).toBeNull();
          }
        }
      }),
      { numRuns: 80 },
    );
  });
});

describe('word diff invariants', () => {
  const textArb = fc.string({ minLength: 0, maxLength: 120 });

  it('computeWordDiff reproduces each input once tags are stripped', () => {
    const unescape = (html: string) =>
      html
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');

    fc.assert(
      fc.property(textArb, textArb, (oldText, newText) => {
        const { oldAnnotated, newAnnotated } = computeWordDiff(oldText, newText);
        expect(unescape(oldAnnotated)).toBe(oldText);
        expect(unescape(newAnnotated)).toBe(newText);
      }),
      { numRuns: 150 },
    );
  });

  it('applyWordDiff wraps text without altering it', () => {
    fc.assert(
      fc.property(textArb, textArb, (oldText, newText) => {
        const oldEl = document.createElement('p');
        const newEl = document.createElement('p');
        oldEl.textContent = oldText;
        newEl.textContent = newText;
        document.body.append(oldEl, newEl);

        try {
          applyWordDiff([oldEl], [newEl]);
          expect(oldEl.textContent).toBe(oldText);
          expect(newEl.textContent).toBe(newText);
          // Highlights only ever appear on the side that owns that change.
          expect(oldEl.querySelectorAll(`.${ADDED_WORD_CLASS}`)).toHaveLength(0);
          expect(newEl.querySelectorAll(`.${REMOVED_WORD_CLASS}`)).toHaveLength(0);
        } finally {
          oldEl.remove();
          newEl.remove();
        }
      }),
      { numRuns: 150 },
    );
  });
});
