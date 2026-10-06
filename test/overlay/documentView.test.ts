import { describe, expect, it } from 'vitest';
import { renderDiff } from '@core/renderDiff';
import { createDocumentView } from '@overlay/document';

const md = (...rows: string[]) => rows.join('\n') + '\n';

const BASE = md('# Guide', '', 'Old text.', '', 'Tail.');
const HEAD = md('# Guide', '', 'New text.', '', 'Tail.');

function build(side: 'old' | 'new' = 'new') {
  const rendered = renderDiff({ oldText: BASE, newText: HEAD });
  const view = createDocumentView({
    content: side === 'old' ? rendered.oldPane : rendered.newPane,
    side,
    label: side === 'old' ? 'Base' : 'Head',
  });
  document.body.appendChild(view.root);
  return { rendered, view };
}

describe('the reading view', () => {
  it('shows one version of the file', () => {
    const { view } = build();
    expect(view.root.textContent).toContain('New text.');
    expect(view.root.textContent).not.toContain('Old text.');
  });

  it('mutes the diff colouring without discarding the marks', () => {
    const { view } = build();
    // The classes stay so threads and the commentable gutter keep their
    // anchors; the stylesheet is what silences them.
    expect(view.docFor('new').classList.contains('mdpd-plain')).toBe(true);
    expect(view.docFor('new').querySelector('.diff-added-block')).not.toBeNull();
  });

  it('reports the side it is showing, whichever block is asked about', () => {
    const { view } = build('old');
    const block = view.docFor('old').children[0] as HTMLElement;
    expect(view.sideFor(block)).toBe('old');
  });

  it('gives both sides the same scroller and document', () => {
    const { view } = build();
    expect(view.scrollerFor('old')).toBe(view.scrollerFor('new'));
    expect(view.docFor('old')).toBe(view.docFor('new'));
  });

  it('has nothing to step between', () => {
    const { view } = build();
    expect(() => view.goToChange(1)).not.toThrow();
  });

  it('removes itself cleanly', () => {
    const { view } = build();
    view.destroy();
    expect(view.root.isConnected).toBe(false);
  });
});
