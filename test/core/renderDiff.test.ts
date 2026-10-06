import { describe, expect, it } from 'vitest';
import { renderDiff } from '@core/renderDiff';
import { ADDED_CLASS, REMOVED_CLASS } from '@core/classify';
import { ADDED_WORD_CLASS, REMOVED_WORD_CLASS } from '@core/wordDiff';

const md = (...rows: string[]) => rows.join('\n') + '\n';

function render(oldText: string, newText: string) {
  return renderDiff({ oldText, newText });
}

const marked = (root: ParentNode, cls: string) => [...root.querySelectorAll(`.${cls}`)];

describe('structural integrity of the rendered diff', () => {
  it('keeps a table whole and marks only the changed row', () => {
    const before = md('| Col | Val |', '| --- | --- |', '| a | 1 |', '| b | 2 |');
    const after = md('| Col | Val |', '| --- | --- |', '| a | 1 |', '| b | 22 |');

    const { newPane } = render(before, after);

    // The defect in upstream was rendering the changed line on its own, which
    // turned a table row into a paragraph. The table must survive intact.
    const tables = newPane.querySelectorAll('table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.querySelectorAll('tbody tr')).toHaveLength(2);

    const added = marked(newPane, ADDED_CLASS);
    expect(added).toHaveLength(1);
    expect(added[0]!.tagName).toBe('TR');
    expect(added[0]!.textContent).toContain('22');
    expect(newPane.querySelector('table')!.classList.contains(ADDED_CLASS)).toBe(false);
  });

  it('keeps ordered list numbering and marks only the inserted item', () => {
    const before = md('1. one', '2. two', '3. three');
    const after = md('1. one', '2. inserted', '3. two', '4. three');

    const { newPane } = render(before, after);

    const lists = newPane.querySelectorAll('ol');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.querySelectorAll('li')).toHaveLength(4);

    const added = marked(newPane, ADDED_CLASS);
    expect(added.every((el) => el.closest('ol') === lists[0])).toBe(true);
    expect(added.some((el) => el.textContent?.includes('inserted'))).toBe(true);
    expect(lists[0]!.classList.contains(ADDED_CLASS)).toBe(false);
  });

  it('keeps a fenced code block intact and highlighted', () => {
    const before = md('```ts', 'const a = 1;', '```');
    const after = md('```ts', 'const a = 2;', '```');

    const { newPane } = render(before, after);

    const pre = newPane.querySelectorAll('pre');
    expect(pre).toHaveLength(1);
    expect(pre[0]!.querySelector('code')).not.toBeNull();
    // highlight.js ran: it emits its own token spans.
    expect(pre[0]!.querySelector('span.hljs-keyword')).not.toBeNull();
    expect(pre[0]!.textContent).toContain('const a = 2;');
    expect(marked(newPane, ADDED_CLASS).length).toBeGreaterThan(0);
  });
});

describe('word-level highlighting', () => {
  it('marks only the changed words inside a renamed heading', () => {
    const before = md('## Intro', '', 'Body stays.');
    const after = md('## Introduction', '', 'Body stays.');

    const { oldPane, newPane } = render(before, after);

    const newHeading = newPane.querySelector('h2')!;
    const oldHeading = oldPane.querySelector('h2')!;
    expect(newHeading.classList.contains(ADDED_CLASS)).toBe(true);
    expect(oldHeading.classList.contains(REMOVED_CLASS)).toBe(true);

    const addedWords = newHeading.querySelectorAll(`.${ADDED_WORD_CLASS}`);
    expect(addedWords.length).toBeGreaterThan(0);
    expect([...addedWords].map((el) => el.textContent).join('')).toBe('duction');
    // The unchanged paragraph is untouched.
    expect(newPane.querySelector('p')!.classList.contains(ADDED_CLASS)).toBe(false);
  });

  it('still highlights words when the text contains HTML special characters', () => {
    // Regression: upstream compared escaped text against already-escaped HTML,
    // so any & < > " made the match fail and word highlighting vanished.
    const before = md('Use A & B < C "quoted" here.');
    const after = md('Use A & B > C "quoted" there.');

    const { oldPane, newPane } = render(before, after);

    expect(newPane.querySelectorAll(`.${ADDED_WORD_CLASS}`).length).toBeGreaterThan(0);
    expect(oldPane.querySelectorAll(`.${REMOVED_WORD_CLASS}`).length).toBeGreaterThan(0);
    // Text content must survive unescaped exactly once.
    expect(newPane.textContent).toContain('Use A & B > C "quoted" there.');
    expect(newPane.innerHTML).not.toContain('&amp;amp;');
  });

  it('leaves word highlighting out when the two sides cannot be paired', () => {
    const before = md('alpha');
    const after = md('beta', '', 'gamma', '', 'delta');

    const { newPane } = render(before, after);
    expect(marked(newPane, ADDED_CLASS).length).toBeGreaterThan(0);
  });
});

describe('sanitization', () => {
  it('strips event handlers from inline HTML in the document', () => {
    const before = md('Hello');
    const after = md('Hello', '', '<img src="x" onerror="alert(1)">');

    const { newPane } = render(before, after);

    const img = newPane.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.hasAttribute('onerror')).toBe(false);
    expect(newPane.innerHTML).not.toContain('onerror');
  });

  it('drops script elements entirely', () => {
    const after = md('Hi', '', '<script>alert(1)</script>');
    const { newPane } = render('', after);
    expect(newPane.querySelector('script')).toBeNull();
    expect(newPane.innerHTML).not.toContain('alert(1)');
  });
});

describe('url resolution', () => {
  it('resolves relative images against each side own commit', () => {
    const before = md('![pic](img/pic.png)');
    const after = md('![pic](img/pic.png)', '', 'extra');

    const { oldPane, newPane } = renderDiff({
      oldText: before,
      newText: after,
      oldBases: { asset: 'https://raw.example/own/repo/BASESHA/docs/' },
      newBases: { asset: 'https://raw.example/own/repo/HEADSHA/docs/' },
    });

    expect(oldPane.querySelector('img')!.getAttribute('src')).toBe(
      'https://raw.example/own/repo/BASESHA/docs/img/pic.png',
    );
    expect(newPane.querySelector('img')!.getAttribute('src')).toBe(
      'https://raw.example/own/repo/HEADSHA/docs/img/pic.png',
    );
  });

  it('leaves absolute urls alone and opens links outside the host page', () => {
    const text = md('[site](https://example.com) and [rel](./other.md)');
    const { newPane } = renderDiff({
      oldText: '',
      newText: text,
      newBases: { link: 'https://github.example/own/repo/blob/HEADSHA/docs/' },
    });

    const links = [...newPane.querySelectorAll('a')];
    expect(links[0]!.getAttribute('href')).toBe('https://example.com');
    expect(links[1]!.getAttribute('href')).toBe(
      'https://github.example/own/repo/blob/HEADSHA/docs/other.md',
    );
    expect(links.every((a) => a.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
  });
});

describe('whole-file edge cases', () => {
  it('marks everything as added for a new file', () => {
    const after = md('# New', '', 'Body');
    const { oldPane, newPane, stats } = render('', after);

    expect(oldPane.children).toHaveLength(0);
    expect(marked(newPane, ADDED_CLASS).length).toBe(newPane.children.length);
    expect(stats).toEqual({ added: 1, removed: 0, modified: 0 });
  });

  it('marks everything as removed for a deleted file', () => {
    const before = md('# Gone', '', 'Body');
    const { oldPane, newPane, stats } = render(before, '');

    expect(newPane.children).toHaveLength(0);
    expect(marked(oldPane, REMOVED_CLASS).length).toBe(oldPane.children.length);
    expect(stats).toEqual({ added: 0, removed: 1, modified: 0 });
  });

  it('marks nothing when the file did not change', () => {
    const text = md('# Same', '', 'Body');
    const { oldPane, newPane, diff } = render(text, text);

    expect(diff.unchanged).toBe(true);
    expect(marked(oldPane, REMOVED_CLASS)).toHaveLength(0);
    expect(marked(newPane, ADDED_CLASS)).toHaveLength(0);
    expect(newPane.querySelector('h1')!.textContent).toBe('Same');
  });

  it('handles two empty documents', () => {
    const { oldPane, newPane, diff } = render('', '');
    expect(diff.unchanged).toBe(true);
    expect(oldPane.children).toHaveLength(0);
    expect(newPane.children).toHaveLength(0);
  });
});
