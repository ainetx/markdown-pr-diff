/**
 * Dev harness. Renders the fixture pairs with the real engine, the real
 * layouts and the real comment layer — no GitHub, no extension APIs, no
 * network. This is the fast iteration loop for the core and the overlay.
 */

import './playground.css';
import { installChromeShim } from './chromeShim';

installChromeShim();

import overlayCss from '../src/overlay/styles.css?inline';
import { renderDiff } from '@core/renderDiff';
import { createSideBySide } from '@overlay/sideBySide';
import { createDocumentView } from '@overlay/document';
import { createSegmentedControl } from '@overlay/segmented';
import { createUnified } from '@overlay/unified';
import { createThreadLayer, type ThreadActions, type ThreadLayer } from '@overlay/threads';
import type { DiffView } from '@overlay/view';
import { fixtureThreads } from './fixtureThreads';

const raw = import.meta.glob('../test/fixtures/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface Fixture {
  name: string;
  before: string;
  after: string;
}

function collectFixtures(): Fixture[] {
  const byName = new Map<string, Partial<Fixture>>();
  for (const [path, content] of Object.entries(raw)) {
    const match = /\/([^/]+)\.(before|after)\.md$/.exec(path);
    if (!match) continue;
    const name = match[1]!;
    const kind = match[2] as 'before' | 'after';
    const entry = byName.get(name) ?? { name };
    entry[kind] = content;
    byName.set(name, entry);
  }
  return [...byName.values()]
    .filter((f): f is Fixture => f.before !== undefined && f.after !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const fixtures = collectFixtures();

const fixtureSelect = document.querySelector<HTMLSelectElement>('#fixture')!;
type Layout = 'side-by-side' | 'unified' | 'document';
let layout: Layout = 'side-by-side';

// The harness drives the real control, so what is exercised here is what ships.
const layoutControl = createSegmentedControl<Layout>({
  doc: document,
  label: 'Layout',
  segments: [
    { value: 'side-by-side', glyph: '⇆', label: 'Side by side' },
    { value: 'unified', glyph: '≡', label: 'Unified' },
    { value: 'document', glyph: '▤', label: 'Reading view' },
  ],
  value: layout,
  onChange: (next) => {
    layout = next;
    syncQuery();
    show();
  },
});
// The control lives in the page here rather than in a shadow root, so the
// overlay stylesheet is applied to the document too. `.md-pr-diff-root`
// carries the custom properties that `:host` provides inside the overlay.
const harnessStyles = document.createElement('style');
harnessStyles.textContent = overlayCss;
document.head.appendChild(harnessStyles);

const controlHost = document.querySelector('#layout-control')!;
controlHost.classList.add('md-pr-diff-root');
controlHost.appendChild(layoutControl.root);
const themeSelect = document.querySelector<HTMLSelectElement>('#theme')!;
const commentsToggle = document.querySelector<HTMLInputElement>('#comments')!;
const statsEl = document.querySelector<HTMLElement>('#stats')!;
const mount = document.querySelector<HTMLElement>('#mount')!;

for (const fixture of fixtures) {
  const option = document.createElement('option');
  option.value = fixture.name;
  option.textContent = fixture.name;
  fixtureSelect.appendChild(option);
}

/** In the playground every write is a no-op that just logs what would happen. */
const actions: ThreadActions = {
  canWrite: true,
  readOnlyReason: '',
  reply: async (thread, body) => void console.warn('reply', thread.id, body),
  create: async (input) => void console.warn('create', input),
  setResolved: async (thread, resolved) => void console.warn('resolve', thread.id, resolved),
  update: async (comment, body) => void console.warn('update', comment.databaseId, body),
  remove: async (comment) => void console.warn('delete', comment.databaseId),
};

let view: DiffView | null = null;
let layer: ThreadLayer | null = null;
let host: HTMLElement | null = null;

function show(): void {
  const fixture = fixtures.find((f) => f.name === fixtureSelect.value);
  if (!fixture) return;

  layer?.destroy();
  view?.destroy();
  host?.remove();

  const rendered = renderDiff({
    oldText: fixture.before,
    newText: fixture.after,
    oldBases: { asset: 'https://github.com/example/repo/raw/base/' },
    newBases: { asset: 'https://github.com/example/repo/raw/head/' },
  });

  host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;';
  const shadow = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayCss);
  shadow.adoptedStyleSheets = [sheet];

  const shell = document.createElement('div');
  shell.className = 'mdpd-shell';
  shell.style.cssText = 'flex:1 1 auto;min-width:0;';

  const content = document.createElement('div');
  content.className = 'mdpd-content';

  const outdatedHost = document.createElement('div');
  outdatedHost.className = 'mdpd-outdated-host';
  outdatedHost.hidden = true;

  view =
    layout === 'document'
      ? createDocumentView({ content: rendered.newPane, side: 'new', label: 'Head' })
      : layout === 'unified'
        ? createUnified({
            oldDoc: rendered.oldPane,
            newDoc: rendered.newPane,
            regions: rendered.diff.regions,
            oldLineCount: rendered.diff.oldLineCount,
          })
        : createSideBySide({
            oldDoc: rendered.oldPane,
            newDoc: rendered.newPane,
            oldLabel: 'Base',
            newLabel: 'Head',
            regions: rendered.diff.regions,
            oldLineCount: rendered.diff.oldLineCount,
          });

  content.appendChild(view.root);
  shell.append(content, outdatedHost);
  shadow.appendChild(shell);
  mount.appendChild(host);

  layer = createThreadLayer({
    doc: document,
    view,
    anchors: rendered.anchors,
    outdatedHost,
    // The harness has no pull request behind it, so every line counts as
    // commentable; on GitHub this set comes from the diff's hunks.
    commentable: {
      left: Array.from({ length: 2000 }, (_, i) => i + 1),
      right: Array.from({ length: 2000 }, (_, i) => i + 1),
    },
    draftBase: {
      host: 'github.com',
      owner: 'example',
      repo: 'repo',
      number: 1,
      path: fixture.name,
    },
    actions,
  });
  layer.render(fixtureThreads(`${fixture.name}.md`));
  layer.setVisible(commentsToggle.checked);

  applyTheme();
  statsEl.textContent = `+${rendered.stats.added} added · −${rendered.stats.removed} removed · ~${rendered.stats.modified} modified`;
  requestAnimationFrame(() => view?.refresh());

  // ?hover=N simulates pointing at the nth block, so the hover-only
  // add-comment affordance can be seen in a screenshot.
  const hoverAt = new URLSearchParams(location.search).get('hover');
  if (hoverAt !== null) {
    setTimeout(() => {
      const scroller = view?.scrollerFor('new');
      const blocks = [...(view?.docFor('new').children ?? [])].filter(
        (el) => el.hasAttribute('data-line-start') && !el.classList.contains('mdpd-thread'),
      );
      const block = blocks[Number(hoverAt) || 0];
      if (!scroller || !block) return;
      const box = block.getBoundingClientRect();
      scroller.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: box.left + 20,
          clientY: box.top + 5,
        }),
      );
      block.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: box.left + 20,
          clientY: box.top + 5,
        }),
      );

      // ?compose=1 also opens the composer, so the comment box and its
      // formatting bar can be seen in a screenshot.
      if (new URLSearchParams(location.search).get('compose') === '1') {
        scroller.querySelector<HTMLButtonElement>('.mdpd-add-comment')?.click();
      }
    }, 400);
  }
}

function applyTheme(): void {
  const theme = themeSelect.value;
  document.body.style.background = theme === 'dark' ? '#0d1117' : '#ffffff';
  document.body.style.color = theme === 'dark' ? '#f0f6fc' : '#1f2328';
  host?.setAttribute('data-mdpd-theme', theme);
}

/** Query parameters make every state reachable by URL, which is what lets a
 *  screenshot run cover each layout and theme without clicking. */
function applyQuery(): void {
  const params = new URLSearchParams(location.search);
  const fixture = params.get('fixture');
  if (fixture && fixtures.some((f) => f.name === fixture)) fixtureSelect.value = fixture;
  const wanted = params.get('layout');
  if (wanted === 'unified' || wanted === 'side-by-side' || wanted === 'document') {
    layout = wanted;
    layoutControl.setValue(wanted);
  }
  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') themeSelect.value = theme;
  const comments = params.get('comments');
  if (comments !== null) commentsToggle.checked = comments !== 'off';
}

function syncQuery(): void {
  const params = new URLSearchParams({
    fixture: fixtureSelect.value,
    layout,
    theme: themeSelect.value,
    comments: commentsToggle.checked ? 'on' : 'off',
  });
  history.replaceState(null, '', `?${params.toString()}`);
}

fixtureSelect.addEventListener('change', () => {
  syncQuery();
  show();
});
themeSelect.addEventListener('change', () => {
  syncQuery();
  applyTheme();
});
commentsToggle.addEventListener('change', () => {
  syncQuery();
  layer?.setVisible(commentsToggle.checked);
});
document.querySelector('#next')!.addEventListener('click', () => view?.goToChange(1));
document.querySelector('#prev')!.addEventListener('click', () => view?.goToChange(-1));

if (fixtures.length > 0) {
  fixtureSelect.value = fixtures[0]!.name;
  applyQuery();
  show();
}
