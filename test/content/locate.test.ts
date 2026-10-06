import { beforeEach, describe, expect, it } from 'vitest';
import {
  describePage,
  findMarkdownFileBlocks,
  isMarkdownPath,
  isPullRequestFilesPage,
} from '../../src/content/locate';

/**
 * Stand-ins for GitHub's diff markup. The class names are deliberately the
 * hashed, meaningless kind the React view emits — nothing here may depend on
 * them, which is the point of these tests.
 */
function fileHeaderWithCopyControl(path: string): string {
  return `
    <div class="Diff-module__wrapper--a1b2">
      <div class="DiffFileHeader-module__row--c3d4">
        <span class="name">${path}</span>
        <clipboard-copy value="${path}" aria-label="Copy path"></clipboard-copy>
        <div class="actions"><button>Viewed</button></div>
      </div>
      <div class="body">
        <table><tr><td data-line-number="1">1</td><td>+ hello</td></tr></table>
      </div>
    </div>`;
}

function mount(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isMarkdownPath', () => {
  it('accepts the markdown extensions and nothing else', () => {
    for (const path of ['a.md', 'docs/b.markdown', 'c.MDX', 'deep/path/d.md']) {
      expect(isMarkdownPath(path), path).toBe(true);
    }
    for (const path of ['a.ts', 'README', 'a.md.ts', 'mdx']) {
      expect(isMarkdownPath(path), path).toBe(false);
    }
  });
});

describe('isPullRequestFilesPage', () => {
  it('recognises both the files and the changes url', () => {
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/5216/files')).toBe(true);
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/5216/changes#r419')).toBe(true);
  });

  it('rejects other pull request tabs', () => {
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/5216')).toBe(false);
    expect(isPullRequestFilesPage('https://github.com/o/r/commits')).toBe(false);
  });
});

describe('findMarkdownFileBlocks', () => {
  it('finds a header through the copy-path control, ignoring hashed class names', () => {
    mount(fileHeaderWithCopyControl('guidelines/DESIGN_REVIEW.md'));

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
  });

  it('resolves a header that is not the diff body', () => {
    mount(fileHeaderWithCopyControl('docs/guide.md'));
    const header = findMarkdownFileBlocks()[0]!.header;
    // Walking up must stop before swallowing the diff table.
    expect(header.querySelector('table')).toBeNull();
    expect(header.textContent).toContain('docs/guide.md');
  });

  it('ignores the same file name in the file tree sidebar', () => {
    mount(`
      <nav aria-label="File Tree navigation">
        <a href="#diff-1" title="DESIGN_REVIEW.md">DESIGN_REVIEW.md</a>
      </nav>
      ${fileHeaderWithCopyControl('guidelines/DESIGN_REVIEW.md')}`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
  });

  it('skips files that are not markdown', () => {
    mount(fileHeaderWithCopyControl('src/main.ts'));
    expect(findMarkdownFileBlocks()).toHaveLength(0);
  });

  it('falls back to a view-file link when there is no copy control', () => {
    mount(`
      <div class="x">
        <div class="hdr">
          <a href="/own/repo/blob/abc123/docs/notes.md">View file</a>
        </div>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('docs/notes.md');
  });

  it('falls back to a title attribute', () => {
    mount('<div class="x"><div class="hdr"><span title="docs/title.md">title.md</span></div></div>');
    expect(findMarkdownFileBlocks()[0]!.path).toBe('docs/title.md');
  });

  it('reports one block per header even when several carriers agree', () => {
    mount(`
      <div class="wrap">
        <div class="hdr">
          <span title="docs/guide.md">docs/guide.md</span>
          <clipboard-copy value="docs/guide.md"></clipboard-copy>
          <a href="/own/repo/blob/sha/docs/guide.md">View</a>
        </div>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('docs/guide.md');
  });

  it('prefers the full path over a truncated label on the same header', () => {
    mount(`
      <div class="wrap">
        <div class="hdr">
          <span title="GUIDE.md">GUIDE.md</span>
          <clipboard-copy value="very/deep/path/GUIDE.md"></clipboard-copy>
        </div>
      </div>`);

    expect(findMarkdownFileBlocks()[0]!.path).toBe('very/deep/path/GUIDE.md');
  });

  it('handles several markdown files on one page', () => {
    mount(fileHeaderWithCopyControl('a.md') + fileHeaderWithCopyControl('docs/b.md'));
    expect(findMarkdownFileBlocks().map((b) => b.path).sort()).toEqual(['a.md', 'docs/b.md']);
  });

  it('finds nothing, and throws nothing, on an unrecognised page', () => {
    mount('<div><p>no files here</p></div>');
    expect(findMarkdownFileBlocks()).toEqual([]);
  });
});

describe('describePage', () => {
  it('reports what was found so a layout change can be diagnosed', () => {
    mount(fileHeaderWithCopyControl('docs/guide.md'));
    const report = describePage();

    expect(report.blocks).toHaveLength(1);
    expect(report.blocks[0]!.path).toBe('docs/guide.md');
    expect(report.blocks[0]!.headerOuterHtml).toContain('docs/guide.md');
    expect(report.candidates.length).toBeGreaterThan(0);
  });

  it('reports an empty result rather than failing when nothing matches', () => {
    mount('<div>nothing</div>');
    const report = describePage();
    expect(report.candidates).toEqual([]);
    expect(report.blocks).toEqual([]);
  });
});

describe('plain-text file names', () => {
  it('finds a header whose path is a bare text node', () => {
    // What GitHub's React diff view actually renders: no title, no copy
    // control, just the path as text.
    mount(`
      <div class="Diff-module__x--9f">
        <div class="DiffFileHeader-module__y--3c">
          <h3><span>guidelines/DESIGN_REVIEW.md</span></h3>
          <button aria-label="Copy path"></button>
          <button>Viewed</button>
        </div>
        <div><table><tr><td data-line-number="1"></td><td>+ x</td></tr></table></div>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
    expect(blocks[0]!.header.querySelector('table')).toBeNull();
  });

  it('ignores markdown names mentioned inside the diff content', () => {
    mount(`
      <div>
        <table>
          <tr><td data-line-number="1"></td><td><span>see docs/other.md for details</span></td></tr>
          <tr><td data-line-number="2"></td><td><span>README.md</span></td></tr>
        </table>
      </div>`);

    expect(findMarkdownFileBlocks()).toEqual([]);
  });

  it('ignores a bare file name in the sidebar tree', () => {
    mount(`
      <nav aria-label="File Tree navigation"><span>DESIGN_REVIEW.md</span></nav>
      <div class="hdr"><span>guidelines/DESIGN_REVIEW.md</span></div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
  });

  it('does not mistake prose that merely contains .md for a file header', () => {
    mount('<div class="hdr"><p>Update the README.md file before merging</p></div>');
    expect(findMarkdownFileBlocks()).toEqual([]);
  });
});

describe('diagnostic samples', () => {
  it('reports surrounding markup when the selectors find nothing', () => {
    // The point of the samples: an empty result still has to be actionable.
    mount('<div class="outer"><div class="mid"><em>weird-wrapper README.md</em></div></div>');

    const report = describePage();
    expect(report.blocks).toEqual([]);
    expect(report.samples.length).toBeGreaterThan(0);
    expect(report.samples[0]!.ancestors[0]).toContain('<em>');
    expect(report.samples[0]!.html).toContain('README.md');
    expect(report.samples[0]!.inNavigation).toBe(false);
  });

  it('marks a sample that came from a navigation region', () => {
    mount('<nav aria-label="File Tree navigation"><span>a.md</span></nav>');
    const report = describePage();
    expect(report.samples[0]!.inNavigation).toBe(true);
  });
});

describe('overflow menus', () => {
  it('ignores the path repeated inside a file overflow menu', () => {
    // Reproduces the real failure: the button landed inside the "..." menu
    // because the menu mentions the file too.
    mount(`
      <div class="file">
        <div class="hdr"><span>guidelines/DESIGN_REVIEW.md</span><button>copy</button></div>
        <action-menu>
          <div role="menu">
            <span>View file guidelines/DESIGN_REVIEW.md</span>
            <span>guidelines/DESIGN_REVIEW.md</span>
          </div>
        </action-menu>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.anchor.closest('[role="menu"]')).toBeNull();
    expect(blocks[0]!.anchor.closest('action-menu')).toBeNull();
  });

  it('still prefers the header when a menu shape is not recognised', () => {
    mount(`
      <div class="file">
        <div class="hdr"><span>docs/a.md</span></div>
        <div class="unknown-menu-shape"><span>docs/a.md</span></div>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.anchor.closest('.unknown-menu-shape')).toBeNull();
  });

  it('anchors to the element showing the path, not the end of the row', () => {
    mount('<div class="hdr"><span id="name">docs/a.md</span><button id="more">…</button></div>');
    const block = findMarkdownFileBlocks()[0]!;
    expect(block.anchor.id).toBe('name');
  });
});

describe('monospace file paths', () => {
  it('finds a path rendered in a code element', () => {
    // GitHub sets the file path in monospace. Treating every `code` element as
    // diff content threw the header away — the bug this guards against.
    mount(`
      <div class="file">
        <div class="hdr"><code>guidelines/DESIGN_REVIEW.md</code><button>copy</button></div>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
  });

  it('still ignores code inside the diff body', () => {
    mount(`
      <table>
        <tr><td data-line-number="1"></td><td><code>docs/inner.md</code></td></tr>
      </table>`);
    expect(findMarkdownFileBlocks()).toEqual([]);
  });
});

describe('diagnostic prioritisation', () => {
  it('skips the document title and puts path-shaped labels first', () => {
    document.title = 'docs: add guidelines/DESIGN_REVIEW.md guideline · Pull Request';
    mount(`
      <h1>docs: add guidelines/DESIGN_REVIEW.md guideline</h1>
      <div class="hdr"><code>guidelines/DESIGN_REVIEW.md</code></div>`);

    const report = describePage();
    expect(report.samples[0]!.text).toBe('guidelines/DESIGN_REVIEW.md');
    expect(report.samples.some((s) => s.ancestors[0]?.includes('title'))).toBe(false);
  });

  it('says why a mention was not taken as a path', () => {
    mount(`
      <nav aria-label="File Tree navigation"><span>a.md</span></nav>
      <p>please update README.md soon</p>`);

    const report = describePage();
    const tree = report.samples.find((s) => s.text === 'a.md');
    const prose = report.samples.find((s) => s.text.startsWith('please'));
    expect(tree!.rejectedBy).toBe('inside navigation');
    expect(prose!.rejectedBy).toBe('text is not a bare path');
  });
});

describe('real GitHub markup', () => {
  /** Trimmed from a live pull request: the exact shape the React diff emits. */
  const REAL_HEADER = `
    <div class="Diff-module__diffTargetable__pirZi" id="diff-693c41" role="region">
      <div class="Diff-module__diffHeaderWrapper__UgUyv">
        <div class="DiffFileHeader-module__diff-file-header__UuNN4">
          <div class="d-flex flex-shrink-0"><button aria-labelledby="_r_4_">chevron</button></div>
          <div class="DiffFileHeader-module__file-path-section__ZcmB1">
            <h3 class="DiffFileHeader-module__file-name__VVXpg">
              <a class="Link--primary" href="#diff-693c41"><code>‎guidelines/DESIGN_REVIEW.md‎</code></a>
            </h3>
            <button aria-labelledby="_r_7_">copy</button>
          </div>
          <div class="d-flex flex-row"><span class="f6">+453</span></div>
        </div>
      </div>
      <table role="grid" aria-label="Diff for: guidelines/DESIGN_REVIEW.md">
        <tbody>
          <tr class="diff-line-row">
            <td class="diff-text-cell"><code class="diff-text addition">
              <div class="diff-text-inner">see <span class="pl-c1">docs/GEARS.md</span> for the catalog</div>
            </code></td>
          </tr>
        </tbody>
      </table>
    </div>`;

  it('finds exactly one file, from the header and not the diff content', () => {
    mount(REAL_HEADER);
    const blocks = findMarkdownFileBlocks();

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('guidelines/DESIGN_REVIEW.md');
    expect(blocks[0]!.anchor.tagName).toBe('CODE');
  });

  it('strips the directionality marks GitHub wraps the path in', () => {
    mount(REAL_HEADER);
    const path = findMarkdownFileBlocks()[0]!.path;
    // These are invisible and are not whitespace, so trim leaves them behind
    // and every later comparison against the API file list fails.
    expect(path.startsWith('‎')).toBe(false);
    expect(path).toBe('guidelines/DESIGN_REVIEW.md');
  });

  it('ignores the tooltip on a button we injected ourselves', () => {
    // Regression: our own button's title was read back as a file path,
    // inventing a second, non-existent file.
    mount(`
      <div class="hdr">
        <code>docs/a.md</code>
        <button class="mdpd-open-button" title="Open the rendered markdown diff for docs/a.md">
          Visualize diff
        </button>
      </div>`);

    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe('docs/a.md');
  });

  it('rejects a title that is a sentence rather than a path', () => {
    mount('<div class="hdr"><span title="Open the diff for docs/a.md">x</span></div>');
    expect(findMarkdownFileBlocks()).toEqual([]);
  });

  it('stays at one block after a second scan, as the observer re-runs', () => {
    mount(REAL_HEADER);
    const first = findMarkdownFileBlocks();
    const button = document.createElement('button');
    button.className = 'mdpd-open-button';
    button.title = `Open the rendered markdown diff for ${first[0]!.path}`;
    first[0]!.anchor.insertAdjacentElement('afterend', button);

    expect(findMarkdownFileBlocks()).toHaveLength(1);
  });
});

describe('long file names', () => {
  /**
   * GitHub truncates a long path inside a clipping container. A button placed
   * in there is clipped away with the name: present in the DOM, invisible on
   * screen — which is exactly how it looked.
   */
  function truncatingHeader(path: string): HTMLElement {
    mount(`
      <div class="DiffFileHeader-module__diff-file-header__UuNN4">
        <div class="d-flex flex-shrink-0"><button>chevron</button></div>
        <div id="path-section" style="overflow: hidden">
          <h3 id="name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap">
            <a href="#diff-1"><code>‎${path}‎</code></a>
          </h3>
          <button id="copy">copy</button>
        </div>
        <div id="stats"><span>+618</span></div>
      </div>`);
    return document.body.firstElementChild as HTMLElement;
  }

  it('places the insertion point outside everything that clips', () => {
    truncatingHeader('gears/mini-chat/docs/ADR/0001-a-very-long-document-name.md');
    const block = findMarkdownFileBlocks()[0]!;

    expect(block.anchor.tagName).toBe('CODE');
    expect(block.insertAfter.id).toBe('path-section');
  });

  it('a button inserted there is not inside the truncating element', () => {
    truncatingHeader('gears/mini-chat/docs/ADR/0001-a-very-long-document-name.md');
    const block = findMarkdownFileBlocks()[0]!;

    const button = document.createElement('button');
    button.className = 'mdpd-open-button';
    block.insertAfter.insertAdjacentElement('afterend', button);

    expect(button.closest('#name')).toBeNull();
    expect(button.closest('#path-section')).toBeNull();
    expect(button.closest('.DiffFileHeader-module__diff-file-header__UuNN4')).not.toBeNull();
  });

  it('falls back to the path element when nothing clips', () => {
    mount('<div class="hdr"><code id="p">docs/a.md</code><button>copy</button></div>');
    const block = findMarkdownFileBlocks()[0]!;
    expect(block.insertAfter.id).toBe('p');
  });

  it('still finds exactly one file for a deeply nested path', () => {
    truncatingHeader('gears/mini-chat/docs/ADR/0010-cpt-cf-mini-chat-adr-runtime-limits.md');
    const blocks = findMarkdownFileBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.path).toBe(
      'gears/mini-chat/docs/ADR/0010-cpt-cf-mini-chat-adr-runtime-limits.md',
    );
  });
});
