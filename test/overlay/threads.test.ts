import { beforeEach, describe, expect, it } from 'vitest';
import { renderDiff, type RenderedDiff } from '@core/renderDiff';
import type { Side } from '@core/types';
import type { ReviewThread } from '@shared/github';
import { createThreadLayer, type ThreadActions } from '@overlay/threads';
import type { DiffView } from '@overlay/view';
import { installChromeMock } from '../support/chromeMock';

const md = (...rows: string[]) => rows.join('\n') + '\n';

const BASE = md(
  '# Guide', //          1
  '', //                 2
  'Opening text.', //    3
  '', //                 4
  '| Col | Val |', //    5
  '| --- | --- |', //    6
  '| a | 1 |', //        7
  '| b | 2 |', //        8
  '', //                 9
  'Closing text.', //   10
);

const HEAD = md(
  '# Guide',
  '',
  'Opening text, revised.',
  '',
  '| Col | Val |',
  '| --- | --- |',
  '| a | 1 |',
  '| b | 22 |',
  '',
  'Closing text.',
);

/** A DiffView stand-in: real rendered panes, fake scroll containers. */
function fakeView(rendered: RenderedDiff): DiffView {
  const scrollers: Record<Side, HTMLElement> = {
    old: document.createElement('div'),
    new: document.createElement('div'),
  };
  scrollers.old.appendChild(rendered.oldPane);
  scrollers.new.appendChild(rendered.newPane);

  const root = document.createElement('div');
  root.append(scrollers.old, scrollers.new);
  document.body.appendChild(root);

  return {
    root,
    scrollerFor: (side) => scrollers[side],
    docFor: (side) => (side === 'old' ? rendered.oldPane : rendered.newPane),
    refresh: () => undefined,
    goToChange: () => undefined,
    destroy: () => root.remove(),
  };
}

function thread(overrides: Partial<ReviewThread>): ReviewThread {
  return {
    id: 'T1',
    path: 'guide.md',
    line: 3,
    startLine: null,
    originalLine: 3,
    side: 'RIGHT',
    startSide: null,
    isResolved: false,
    isOutdated: false,
    viewerCanResolve: true,
    viewerCanUnresolve: true,
    diffHunk: '@@ -1 +1 @@',
    comments: [
      {
        id: 'C1',
        databaseId: 1,
        author: { login: 'reviewer', avatarUrl: 'https://example/a.png', url: 'https://example' },
        bodyMarkdown: 'Please rephrase **this**.',
        createdAt: new Date().toISOString(),
        url: 'https://example/comment',
        viewerDidAuthor: false,
      },
    ],
    ...overrides,
  };
}

const actions: ThreadActions = {
  canWrite: true,
  readOnlyReason: '',
  reply: async () => undefined,
  create: async () => undefined,
  setResolved: async () => undefined,
  update: async () => undefined,
  remove: async () => undefined,
};

/** Every line commentable, unless a test narrows it deliberately. */
const allLines = (): number[] => Array.from({ length: 200 }, (_, i) => i + 1);

function setup(commentable = { left: allLines(), right: allLines() }) {
  const rendered = renderDiff({ oldText: BASE, newText: HEAD });
  const view = fakeView(rendered);
  const outdatedHost = document.createElement('div');
  document.body.appendChild(outdatedHost);

  const layer = createThreadLayer({
    doc: document,
    view,
    anchors: rendered.anchors,
    outdatedHost,
    draftBase: { host: 'github.com', owner: 'o', repo: 'r', number: 1, path: 'guide.md' },
    commentable,
    actions,
  });

  return { rendered, view, outdatedHost, layer };
}

describe('thread placement', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.replaceChildren();
  });

  it('places a thread right after the block it refers to', () => {
    const { view, layer } = setup();
    layer.render([thread({ line: 3, side: 'RIGHT' })]);

    const paragraph = [...view.docFor('new').children].find((el) =>
      el.textContent?.includes('Opening text'),
    )!;
    expect(paragraph.nextElementSibling?.classList.contains('mdpd-thread')).toBe(true);
  });

  it('puts a RIGHT-side thread in the head pane and a LEFT-side thread in the base pane', () => {
    const { view, layer } = setup();
    layer.render([
      thread({ id: 'R', line: 3, side: 'RIGHT' }),
      thread({ id: 'L', line: 10, side: 'LEFT' }),
    ]);

    expect(view.docFor('new').querySelectorAll('.mdpd-thread')).toHaveLength(1);
    expect(view.docFor('old').querySelectorAll('.mdpd-thread')).toHaveLength(1);
  });

  it('anchors a thread on a table row after the table, never inside it', () => {
    const { view, layer } = setup();
    layer.render([thread({ line: 8, side: 'RIGHT' })]);

    const pane = view.docFor('new');
    const table = pane.querySelector('table')!;
    // The card must be a sibling of the table, not spliced into its markup.
    expect(table.querySelector('.mdpd-thread')).toBeNull();
    expect(table.nextElementSibling?.classList.contains('mdpd-thread')).toBe(true);
    // And the row itself is badged, so the reader sees where the comment lands.
    const badgedRow = pane.querySelector('tr .mdpd-comment-badge');
    expect(badgedRow).not.toBeNull();
  });

  it('collects threads that lost their anchor into the outdated section', () => {
    const { view, outdatedHost, layer } = setup();
    layer.render([thread({ id: 'O', line: null, isOutdated: true })]);

    expect(view.docFor('new').querySelectorAll('.mdpd-thread')).toHaveLength(0);
    expect(outdatedHost.hidden).toBe(false);
    expect(outdatedHost.querySelectorAll('.mdpd-thread')).toHaveLength(1);
    expect(outdatedHost.textContent).toContain('Outdated comments (1)');
  });

  it('renders comment bodies as markdown and strips injected handlers', () => {
    const { view, layer } = setup();
    layer.render([
      thread({
        comments: [
          {
            id: 'C',
            databaseId: 2,
            author: null,
            bodyMarkdown: 'Look: **bold** <img src=x onerror="alert(1)">',
            createdAt: new Date().toISOString(),
            url: 'https://example/c',
            viewerDidAuthor: false,
          },
        ],
      }),
    ]);

    const body = view.docFor('new').querySelector('.mdpd-comment-body')!;
    expect(body.querySelector('strong')?.textContent).toBe('bold');
    expect(body.innerHTML).not.toContain('onerror');
  });

  it('shows resolved threads collapsed', () => {
    const { view, layer } = setup();
    layer.render([thread({ isResolved: true })]);

    const card = view.docFor('new').querySelector('.mdpd-thread')!;
    expect(card.classList.contains('is-resolved')).toBe(true);
    expect(card.querySelector<HTMLElement>('.mdpd-thread-body')!.hidden).toBe(true);
  });

  it('hides and restores every thread through the visibility toggle', () => {
    const { view, layer } = setup();
    layer.render([thread({ line: 3 }), thread({ id: 'T2', line: 10 })]);

    const cards = () => [...view.root.querySelectorAll<HTMLElement>('.mdpd-thread')];
    expect(cards().every((c) => !c.hidden)).toBe(true);

    layer.setVisible(false);
    expect(cards().every((c) => c.hidden)).toBe(true);
    expect(view.root.querySelectorAll<HTMLElement>('.mdpd-comment-badge')[0]!.hidden).toBe(true);

    layer.setVisible(true);
    expect(cards().every((c) => !c.hidden)).toBe(true);
  });

  it('offers no composer when the overlay is read-only', () => {
    const rendered = renderDiff({ oldText: BASE, newText: HEAD });
    const view = fakeView(rendered);
    const outdatedHost = document.createElement('div');
    const layer = createThreadLayer({
      doc: document,
      view,
      anchors: rendered.anchors,
      outdatedHost,
      draftBase: { host: 'github.com', owner: 'o', repo: 'r', number: 1, path: 'guide.md' },
      commentable: { left: allLines(), right: allLines() },
      actions: { ...actions, canWrite: false, readOnlyReason: 'Connect an account.' },
    });

    layer.render([thread({})]);
    expect(view.root.querySelector('.mdpd-add-comment')).toBeNull();
    expect(view.root.textContent).toContain('Connect an account.');
  });

  it('leaves no trace of itself after destroy', () => {
    const { view, layer } = setup();
    layer.render([thread({})]);
    layer.destroy();

    expect(view.root.querySelectorAll('.mdpd-thread')).toHaveLength(0);
    expect(view.root.querySelectorAll('.mdpd-comment-badge')).toHaveLength(0);
    expect(view.root.querySelectorAll('.mdpd-add-comment')).toHaveLength(0);
  });
});

describe('the add-comment affordance', () => {
  function hoverBlock(view: DiffView, index = 0) {
    const block = [...view.docFor('new').children].filter(
      (el) => el.hasAttribute('data-line-start') && !el.classList.contains('mdpd-thread'),
    )[index]!;
    block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    return block;
  }

  const addButton = (view: DiffView) =>
    view.scrollerFor('new').querySelector<HTMLElement>('.mdpd-add-comment')!;

  it('appears when a block is hovered', () => {
    const { view, layer } = setup();
    layer.render([]);

    expect(addButton(view).hidden).toBe(true);
    hoverBlock(view);
    expect(addButton(view).hidden).toBe(false);
  });

  it('stays put while the pointer crosses the gap towards it', () => {
    // The button sits in the gutter, left of the text. Hiding it the moment
    // the pointer left the block made it impossible to actually click.
    const { view, layer } = setup();
    layer.render([]);
    hoverBlock(view);

    const scroller = view.scrollerFor('new');
    scroller.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(addButton(view).hidden).toBe(false);
  });

  it('goes away when the pointer leaves the pane', () => {
    const { view, layer } = setup();
    layer.render([]);
    hoverBlock(view);

    view.scrollerFor('new').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(addButton(view).hidden).toBe(true);
  });

  it('is absent entirely when writing is not possible', () => {
    const rendered = renderDiff({ oldText: BASE, newText: HEAD });
    const view = fakeView(rendered);
    const layer = createThreadLayer({
      doc: document,
      view,
      anchors: rendered.anchors,
      outdatedHost: document.createElement('div'),
      draftBase: { host: 'github.com', owner: 'o', repo: 'r', number: 1, path: 'guide.md' },
      commentable: { left: allLines(), right: allLines() },
      actions: { ...actions, canWrite: false },
    });
    layer.render([]);

    expect(view.scrollerFor('new').querySelector('.mdpd-add-comment')).toBeNull();
  });
});

describe('where a comment may be anchored', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.replaceChildren();
  });

  /** Triggers the hover that moves the add button onto a given element. */
  function hover(_view: DiffView, el: Element) {
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  }

  /** The most specific element carrying a given head-side line. */
  function lineElement(view: DiffView, line: number): Element {
    const all = [...view.docFor('new').querySelectorAll(`[data-line-start="${line}"]`)];
    return all.find((el) => el.querySelector('[data-line-start]') === null) ?? all[0]!;
  }

  const addButton = (view: DiffView) =>
    view.scrollerFor('new').querySelector<HTMLElement>('.mdpd-add-comment');

  it('offers no button at all when no line of the file is in the diff', () => {
    // GitHub only accepts a comment on a line inside a hunk; anywhere else it
    // answers "pull_request_review_thread.line: could not be resolved".
    const { view, layer } = setup({ left: [], right: [] });
    layer.render([]);
    hover(view, view.docFor('new').children[0]!);
    expect(addButton(view)?.hidden).not.toBe(false);
  });

  it('targets a single table row, not the whole table', () => {
    const { view, layer } = setup();
    layer.render([]);

    const row = view.docFor('new').querySelector('tbody tr:last-child')!;
    hover(view, row);

    // The row is its own target: the table is not the most specific element
    // carrying line numbers.
    expect(row.querySelector('[data-line-start]')).toBeNull();
    expect(row.hasAttribute('data-line-start')).toBe(true);
    expect(addButton(view)!.hidden).toBe(false);
  });

  it('puts the composer after the table even when the row is the target', async () => {
    const { view, layer } = setup();
    layer.render([]);

    const table = view.docFor('new').querySelector('table')!;
    hover(view, lineElement(view, 8));
    addButton(view)!.click();

    expect(table.querySelector('.mdpd-thread-new')).toBeNull();
    expect(table.nextElementSibling?.classList.contains('mdpd-thread-new')).toBe(true);
  });

  it('anchors to a line that is actually in the diff', async () => {
    const posted: { line: number; startLine?: number }[] = [];
    const rendered = renderDiff({ oldText: BASE, newText: HEAD });
    const view = fakeView(rendered);
    const layer = createThreadLayer({
      doc: document,
      view,
      anchors: rendered.anchors,
      outdatedHost: document.createElement('div'),
      draftBase: { host: 'github.com', owner: 'o', repo: 'r', number: 1, path: 'guide.md' },
      // Only line 8 of the head side is inside a hunk.
      commentable: { left: [], right: [8] },
      actions: {
        ...actions,
        create: async (input) => {
          posted.push({ line: input.line, startLine: input.startLine });
        },
      },
    });
    layer.render([]);

    hover(view, lineElement(view, 8));
    addButton(view)!.click();

    const textarea = document.querySelector<HTMLTextAreaElement>('.mdpd-textarea')!;
    textarea.value = 'Needs work';
    [...document.querySelectorAll<HTMLButtonElement>('.mdpd-btn-primary')]
      .find((b) => b.textContent === 'Comment')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(posted).toEqual([{ line: 8, startLine: undefined }]);
  });

  it('clears the toggle after a comment is posted', async () => {
    const { view, layer } = setup();
    layer.render([]);

    hover(view, view.docFor('new').children[0]!);
    const button = addButton(view)!;
    button.click();
    expect(button.textContent).toBe('×');

    const textarea = document.querySelector<HTMLTextAreaElement>('.mdpd-textarea')!;
    textarea.value = 'Done';
    [...document.querySelectorAll<HTMLButtonElement>('.mdpd-btn-primary')]
      .find((b) => b.textContent === 'Comment')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The regression: the form went away but the button stayed on "×".
    expect(button.textContent).toBe('+');
    expect(document.querySelector('.mdpd-thread-new')).toBeNull();
  });
});

describe('the button never points somewhere it cannot comment', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.replaceChildren();
  });

  function deepest(view: DiffView, line: number): HTMLElement {
    const all = [...view.docFor('new').querySelectorAll<HTMLElement>(`[data-line-start="${line}"]`)];
    return all.find((el) => el.querySelector('[data-line-start]') === null) ?? all[0]!;
  }

  const addButton = (view: DiffView) =>
    view.scrollerFor('new').querySelector<HTMLElement>('.mdpd-add-comment')!;

  it('hides when the pointer moves onto a block with no diff', () => {
    // The regression: the button stayed visible next to an untouched block
    // while still aimed at a different one, so a comment would have landed
    // somewhere the reader never pointed at.
    const { view, layer } = setup({ left: [], right: [1] });
    layer.render([]);

    deepest(view, 1).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(addButton(view).hidden).toBe(false);

    deepest(view, 3).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(addButton(view).hidden).toBe(true);
  });

  it('stays hidden over a block with no diff even on first hover', () => {
    const { view, layer } = setup({ left: [], right: [1] });
    layer.render([]);

    deepest(view, 3).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(addButton(view).hidden).toBe(true);
  });

  it('keeps showing while its own composer is open', () => {
    const { view, layer } = setup({ left: [], right: [1] });
    layer.render([]);

    deepest(view, 1).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    addButton(view).click();

    // Drifting onto a block with no diff must not take away the way to close
    // the form that is still open.
    deepest(view, 3).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(addButton(view).hidden).toBe(false);
    expect(addButton(view).textContent).toBe('×');
  });
});

describe('the toggle reflects what is on screen', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.replaceChildren();
  });

  const addButton = (view: DiffView) =>
    view.scrollerFor('new').querySelector<HTMLElement>('.mdpd-add-comment')!;

  it('falls back to "+" if the composer is removed without going through close', () => {
    // Anything that re-renders the pane can take the form away. The button has
    // to notice, or it sits there offering to discard something that is gone.
    const { view, layer } = setup();
    layer.render([]);

    const block = view.docFor('new').children[0]!;
    block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    addButton(view).click();
    expect(addButton(view).textContent).toBe('×');

    view.docFor('new').querySelector('.mdpd-thread-new')!.remove();
    block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    view.scrollerFor('new').dispatchEvent(new MouseEvent('mouseleave'));
    block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(addButton(view).textContent).toBe('+');
  });

  it('a fresh render leaves the button on "+"', () => {
    const { view, layer } = setup();
    layer.render([]);

    const block = view.docFor('new').children[0]!;
    block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    addButton(view).click();
    expect(addButton(view).textContent).toBe('×');

    layer.render([]);
    expect(addButton(view).textContent).toBe('+');
    expect(document.querySelector('.mdpd-thread-new')).toBeNull();
  });
});
