import { describe, expect, it } from 'vitest';
import {
  insertCodeBlock,
  insertLink,
  togglePrefix,
  toggleWrap,
  type Selection,
} from '@overlay/markdownEdit';

/** `|` marks the caret, `[` and `]` a selection, so cases read as what you see. */
function parse(spec: string): Selection {
  if (spec.includes('[')) {
    const start = spec.indexOf('[');
    const end = spec.indexOf(']') - 1;
    return { text: spec.replace('[', '').replace(']', ''), start, end };
  }
  const caret = spec.indexOf('|');
  return { text: spec.replace('|', ''), start: caret, end: caret };
}

function show(selection: Selection): string {
  const { text, start, end } = selection;
  if (start === end) return `${text.slice(0, start)}|${text.slice(start)}`;
  return `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`;
}

describe('toggleWrap', () => {
  it('wraps a selection', () => {
    expect(show(toggleWrap(parse('say [hello] there'), '**'))).toBe('say **[hello]** there');
  });

  it('puts the caret between the markers when nothing is selected', () => {
    expect(show(toggleWrap(parse('say | there'), '**'))).toBe('say **|** there');
  });

  it('removes the markers when pressed again', () => {
    // Bold twice should leave the text exactly as it was.
    const once = toggleWrap(parse('say [hello] there'), '**');
    expect(show(toggleWrap(once, '**'))).toBe('say [hello] there');
  });

  it('unwraps when the markers are inside the selection', () => {
    expect(show(toggleWrap(parse('say [**hello**] there'), '**'))).toBe('say [hello] there');
  });

  it('handles asymmetric markers', () => {
    expect(show(toggleWrap(parse('[x]'), '<!--', '-->'))).toBe('<!--[x]-->');
  });
});

describe('togglePrefix', () => {
  it('prefixes every line the selection touches', () => {
    expect(togglePrefix(parse('[one\ntwo]'), '- ').text).toBe('- one\n- two');
  });

  it('removes the prefix when every line already has it', () => {
    expect(togglePrefix(parse('[- one\n- two]'), '- ').text).toBe('one\ntwo');
  });

  it('adds the prefix when only some lines have it', () => {
    expect(togglePrefix(parse('[- one\ntwo]'), '- ').text).toBe('- - one\n- two');
  });

  it('works from a caret with no selection', () => {
    expect(togglePrefix(parse('he|llo'), '> ').text).toBe('> hello');
  });

  it('numbers a list instead of repeating a marker', () => {
    expect(togglePrefix(parse('[one\ntwo\nthree]'), '1. ', { numbered: true }).text).toBe(
      '1. one\n2. two\n3. three',
    );
  });

  it('removes numbering when pressed again', () => {
    const once = togglePrefix(parse('[one\ntwo]'), '1. ', { numbered: true });
    expect(togglePrefix(once, '1. ', { numbered: true }).text).toBe('one\ntwo');
  });

  it('leaves surrounding lines alone', () => {
    expect(togglePrefix(parse('before\n[middle]\nafter'), '> ').text).toBe(
      'before\n> middle\nafter',
    );
  });
});

describe('insertLink', () => {
  it('keeps the selection as the label and selects the url', () => {
    const result = insertLink(parse('see [docs] now'));
    expect(result.text).toBe('see [docs](url) now');
    expect(result.text.slice(result.start, result.end)).toBe('url');
  });

  it('uses a placeholder label when nothing is selected', () => {
    const result = insertLink(parse('see | now'));
    expect(result.text).toBe('see [text](url) now');
    expect(result.text.slice(result.start, result.end)).toBe('url');
  });
});

describe('insertCodeBlock', () => {
  it('fences the selection on its own lines', () => {
    expect(insertCodeBlock(parse('[const a = 1;]')).text).toBe('```\nconst a = 1;\n```\n');
  });

  it('starts on a new line when the caret is mid-line', () => {
    expect(insertCodeBlock(parse('text|')).text).toBe('text\n```\n\n```\n');
  });

  it('leaves the caret on the language line', () => {
    const result = insertCodeBlock(parse('[x]'));
    expect(result.text.slice(0, result.start)).toBe('```');
  });
});
