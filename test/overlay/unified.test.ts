import { describe, expect, it } from 'vitest';
import { renderDiff } from '@core/renderDiff';
import { createUnified } from '@overlay/unified';

const md = (...rows: string[]) => rows.join('\n') + '\n';

function unify(before: string, after: string) {
  const rendered = renderDiff({ oldText: before, newText: after });
  const view = createUnified({
    oldDoc: rendered.oldPane,
    newDoc: rendered.newPane,
    regions: rendered.diff.regions,
    oldLineCount: rendered.diff.oldLineCount,
  });
  return { view, column: view.root.querySelector('.mdpd-unified')! };
}

describe('unified layout', () => {
  it('shows an unchanged block exactly once', () => {
    const before = md('# Title', '', 'Stable paragraph.', '', 'Changed here.');
    const after = md('# Title', '', 'Stable paragraph.', '', 'Changed there.');
    const { column } = unify(before, after);

    const stable = [...column.querySelectorAll('p')].filter((p) =>
      p.textContent?.includes('Stable paragraph.'),
    );
    expect(stable).toHaveLength(1);
  });

  it('shows both versions of a block whose interior changed', () => {
    // The regression this guards: collapsing a paired table to the head copy
    // only, which silently loses what the changed row used to say.
    const before = md('| A | B |', '| - | - |', '| 1 | old |');
    const after = md('| A | B |', '| - | - |', '| 1 | new |');
    const { column } = unify(before, after);

    expect(column.querySelectorAll('table')).toHaveLength(2);
    expect(column.textContent).toContain('old');
    expect(column.textContent).toContain('new');
    expect(column.querySelector('table')!.querySelector('.diff-removed-block')).not.toBeNull();
  });

  it('keeps a removed block in the position it used to occupy', () => {
    const before = md('First.', '', 'Doomed.', '', 'Last.');
    const after = md('First.', '', 'Last.');
    const { column } = unify(before, after);

    const texts = [...column.children].map((el) => el.textContent?.trim());
    expect(texts).toEqual(['First.', 'Doomed.', 'Last.']);
    expect(column.querySelectorAll('.diff-removed-block')).toHaveLength(1);
  });

  it('loses no content from either version', () => {
    const before = md('# Doc', '', 'Alpha.', '', '- one', '- two');
    const after = md('# Doc', '', 'Beta.', '', '- one', '- two', '- three');
    const { column } = unify(before, after);

    const text = column.textContent ?? '';
    for (const fragment of ['Alpha.', 'Beta.', 'one', 'two', 'three']) {
      expect(text, `missing ${fragment}`).toContain(fragment);
    }
  });

  it('renders an added file as a single added column', () => {
    const { column } = unify('', md('# New', '', 'Body.'));
    expect(column.querySelectorAll('.diff-removed-block')).toHaveLength(0);
    expect(column.querySelectorAll('.diff-added-block').length).toBeGreaterThan(0);
    expect(column.textContent).toContain('Body.');
  });

  it('walks changes with the cursor', () => {
    const before = md('a', '', 'b', '', 'c');
    const after = md('a', '', 'B', '', 'c');
    const { view } = unify(before, after);
    // Only asserts that stepping is safe; scroll geometry needs a real layout.
    expect(() => {
      view.goToChange(1);
      view.goToChange(1);
      view.goToChange(-1);
    }).not.toThrow();
  });
});
