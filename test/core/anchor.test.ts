import { describe, expect, it } from 'vitest';
import { renderDiff } from '@core/renderDiff';

const md = (...rows: string[]) => rows.join('\n') + '\n';

/** Renders one document and returns the index for its (unchanged) new side. */
function indexOf(text: string) {
  return renderDiff({ oldText: text, newText: text }).anchors.new;
}

describe('buildAnchorIndex', () => {
  const doc = md(
    '# Title', //            line 1
    '', //                   line 2
    'First paragraph.', //   line 3
    '', //                   line 4
    '| Col | Val |', //      line 5
    '| --- | --- |', //      line 6
    '| a | 1 |', //          line 7
    '| b | 2 |', //          line 8
    '', //                   line 9
    '- item one', //         line 10
    '- item two', //         line 11
  );

  it('resolves a line to the most specific element covering it', () => {
    const el = indexOf(doc).elementForLine(1);
    expect(el!.tagName).toBe('H1');
  });

  it('resolves a table body line to its row, not the whole table', () => {
    const el = indexOf(doc).elementForLine(8)!;
    expect(el.tagName).toBe('TR');
    expect(el.textContent).toContain('2');
  });

  it('resolves a list line to its item, not the whole list', () => {
    const el = indexOf(doc).elementForLine(11)!;
    expect(el.closest('li')).not.toBeNull();
    expect(el.closest('li')!.textContent).toContain('item two');
  });

  it('falls back to the nearest preceding block for a blank line', () => {
    const el = indexOf(doc).elementForLine(4)!;
    expect(el.textContent).toContain('First paragraph.');
  });

  it('falls back to the last block for a line past the end', () => {
    const el = indexOf(doc).elementForLine(999)!;
    expect(el.closest('ul')).not.toBeNull();
  });

  it('returns something for a line before any block rather than nothing', () => {
    const el = indexOf(md('', '', '# Later'));
    expect(el.elementForLine(1)).not.toBeNull();
  });

  it('exposes the source range an element covers', () => {
    const index = indexOf(doc);
    const heading = index.elementForLine(1)!;
    expect(index.rangeForElement(heading)).toEqual({ start: 1, end: 1 });
  });

  it('reports an empty index for an empty document', () => {
    expect(indexOf('').isEmpty()).toBe(true);
  });
});
