import { describe, expect, it } from 'vitest';
import { renderMarkdownFragment } from '@core/renderMarkdown';

function render(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(renderMarkdownFragment(markdown, document));
  return host;
}

describe('collapsible sections', () => {
  const COLLAPSIBLE = [
    '<details>',
    '<summary>Verification prompt</summary>',
    '',
    'Paste into your coding agent.',
    '',
    '```',
    'some command',
    '```',
    '',
    '</details>',
    '',
  ].join('\n');

  it('keeps the body inside the details element', () => {
    // The regression: markdown-it splits this into two html_block tokens, and
    // wrapping each half broke the nesting, so the body escaped the <details>
    // and showed permanently while the triangle stayed empty and collapsed.
    const host = render(COLLAPSIBLE);
    const details = host.querySelector('details');

    expect(details).not.toBeNull();
    expect(details!.querySelector('summary')?.textContent).toBe('Verification prompt');
    expect(details!.textContent).toContain('Paste into your coding agent.');
    expect(details!.querySelector('pre')).not.toBeNull();
  });

  it('leaves nothing from the body outside the details element', () => {
    const host = render(COLLAPSIBLE);
    const details = host.querySelector('details')!;
    for (const child of host.children) {
      if (child === details) continue;
      expect(child.textContent).not.toContain('Paste into your coding agent.');
    }
  });

  it('renders collapsed by default, as the author wrote it', () => {
    const host = render(COLLAPSIBLE);
    expect(host.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('honours an explicitly open details', () => {
    const host = render('<details open>\n<summary>S</summary>\n\nbody\n\n</details>\n');
    expect(host.querySelector('details')!.hasAttribute('open')).toBe(true);
  });

  it('still wraps a self-contained html block so it can be classified', () => {
    const host = render('<div class="note">all in one token</div>\n');
    const wrapper = host.querySelector('.md-raw-html');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute('data-line-start')).toBe('1');
  });

  it('does not wrap a fragment that leaves a tag open', () => {
    const host = render('<section>\n\ntext\n\n</section>\n');
    expect(host.querySelector('section')).not.toBeNull();
    expect(host.querySelector('section')!.textContent).toContain('text');
  });
});
