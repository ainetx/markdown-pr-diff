import { describe, expect, it } from 'vitest';
import { renderDiff } from '@core/renderDiff';
import type { Side } from '@core/types';
import { captureAnchor, restoreAnchor } from '@overlay/scrollAnchor';
import type { DiffView } from '@overlay/view';

const md = (...rows: string[]) => rows.join('\n') + '\n';

const BASE = md('# One', '', 'Two.', '', 'Three.', '', 'Four.', '', 'Five.');
const HEAD = md('# One', '', 'Two.', '', 'Three changed.', '', 'Four.', '', 'Five.');

const BLOCK_HEIGHT = 100;

/**
 * jsdom has no layout, so geometry is supplied: every top-level block is
 * BLOCK_HEIGHT tall, stacked, and the pane scrolls over them.
 */
function layOut(scroller: HTMLElement, root: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
    configurable: true,
  });
  scroller.getBoundingClientRect = () => ({ top: 0, height: 300 }) as DOMRect;

  [...root.children].forEach((child, index) => {
    (child as HTMLElement).getBoundingClientRect = () =>
      ({ top: index * BLOCK_HEIGHT - scrollTop, height: BLOCK_HEIGHT }) as DOMRect;
  });
}

function viewOf(text: string): { view: DiffView; root: HTMLElement; scroller: HTMLElement } {
  const rendered = renderDiff({ oldText: text, newText: text });
  const root = rendered.newPane;
  const scroller = document.createElement('div');
  scroller.appendChild(root);
  document.body.replaceChildren(scroller);
  layOut(scroller, root);

  const view: DiffView = {
    root: scroller,
    scrollerFor: () => scroller,
    docFor: () => root,
    sideFor: () => 'new' as Side,
    refresh: () => undefined,
    goToChange: () => undefined,
    destroy: () => undefined,
  };
  return { view, root, scroller };
}

describe('captureAnchor', () => {
  it('reports the line at the top of the pane', () => {
    const { view, scroller } = viewOf(HEAD);
    scroller.scrollTop = 2 * BLOCK_HEIGHT;

    const anchor = captureAnchor(view);
    expect(anchor).not.toBeNull();
    expect(anchor!.offset).toBe(0);
    // The third top-level block, whatever line that turns out to be.
    expect(anchor!.line).toBeGreaterThan(1);
  });

  it('anchors to the block straddling the top, with its offset above it', () => {
    // Scrolled 70px into the second block: that block is what is being read,
    // and remembering it as "70px above the fold" is what reproduces the
    // viewport exactly rather than approximately.
    const { view, scroller } = viewOf(HEAD);
    scroller.scrollTop = 2 * BLOCK_HEIGHT - 30;

    expect(captureAnchor(view)!.offset).toBe(-70);
  });

  it('anchors to the first block when the pane is at the top', () => {
    const { view } = viewOf(HEAD);
    expect(captureAnchor(view)!.line).toBe(1);
  });

  it('returns nothing for an empty document', () => {
    const { view } = viewOf('');
    expect(captureAnchor(view)).toBeNull();
  });
});

describe('restoreAnchor', () => {
  it('puts the same line back at the same place', () => {
    const { view, scroller } = viewOf(HEAD);
    scroller.scrollTop = 2 * BLOCK_HEIGHT - 30;
    const anchor = captureAnchor(view)!;

    scroller.scrollTop = 0;
    restoreAnchor(view, anchor);

    expect(captureAnchor(view)).toEqual(anchor);
  });

  it('survives a rebuild of the document', () => {
    // What a layout switch does: the panes are thrown away and rendered again.
    const first = viewOf(HEAD);
    first.scroller.scrollTop = 3 * BLOCK_HEIGHT;
    const anchor = captureAnchor(first.view)!;

    const second = viewOf(HEAD);
    restoreAnchor(second.view, anchor);

    expect(captureAnchor(second.view)!.line).toBe(anchor.line);
  });

  it('falls back to the nearest line above when the exact one is gone', () => {
    // The reading view shows one version, so a line of the other one has no
    // element at all; landing near it beats being thrown back to the top.
    const { view } = viewOf(BASE);
    restoreAnchor(view, { side: 'new', line: 9999, offset: 0 });
    expect(captureAnchor(view)!.line).toBeGreaterThan(1);
  });

  it('does nothing rather than throwing when there is no content', () => {
    const { view } = viewOf('');
    expect(() => restoreAnchor(view, { side: 'new', line: 3, offset: 0 })).not.toThrow();
  });
});
