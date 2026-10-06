/**
 * The formatting bar above the comment box.
 *
 * Mirrors what GitHub offers, including the shortcuts people already have in
 * their fingers, so writing a review comment here does not mean remembering
 * markdown that the native box would have inserted for you.
 */

import {
  insertCodeBlock,
  insertLink,
  togglePrefix,
  toggleWrap,
  type Selection,
} from './markdownEdit';

interface Command {
  /** Shown on the button. */
  glyph: string;
  title: string;
  /** Lower-case key for Cmd/Ctrl + key. */
  shortcut?: string;
  apply(selection: Selection): Selection;
}

const COMMANDS: Command[] = [
  {
    glyph: 'B',
    title: 'Bold (⌘/Ctrl + B)',
    shortcut: 'b',
    apply: (s) => toggleWrap(s, '**'),
  },
  {
    glyph: 'I',
    title: 'Italic (⌘/Ctrl + I)',
    shortcut: 'i',
    apply: (s) => toggleWrap(s, '_'),
  },
  {
    glyph: 'S',
    title: 'Strikethrough',
    apply: (s) => toggleWrap(s, '~~'),
  },
  {
    glyph: 'H',
    title: 'Heading',
    apply: (s) => togglePrefix(s, '### '),
  },
  {
    glyph: '🔗',
    title: 'Link (⌘/Ctrl + K)',
    shortcut: 'k',
    apply: insertLink,
  },
  {
    glyph: '‹›',
    title: 'Inline code (⌘/Ctrl + E)',
    shortcut: 'e',
    apply: (s) => toggleWrap(s, '`'),
  },
  {
    glyph: '⌗',
    title: 'Code block',
    apply: insertCodeBlock,
  },
  {
    glyph: '❝',
    title: 'Quote',
    apply: (s) => togglePrefix(s, '> '),
  },
  {
    glyph: '•',
    title: 'Bulleted list',
    apply: (s) => togglePrefix(s, '- '),
  },
  {
    glyph: '1.',
    title: 'Numbered list',
    apply: (s) => togglePrefix(s, '1. ', { numbered: true }),
  },
  {
    glyph: '☑',
    title: 'Task list',
    apply: (s) => togglePrefix(s, '- [ ] '),
  },
];

/** Applies a command to the textarea and keeps the selection sensible. */
function run(textarea: HTMLTextAreaElement, command: Command): void {
  const result = command.apply({
    text: textarea.value,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  });

  textarea.value = result.text;
  textarea.setSelectionRange(result.start, result.end);
  textarea.focus();
  // Draft saving and anything else listening watches for input events, which
  // setting `value` from script does not produce on its own.
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function createMarkdownToolbar(doc: Document, textarea: HTMLTextAreaElement): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'mdpd-format-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Markdown formatting');

  for (const command of COMMANDS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'mdpd-format-btn';
    button.textContent = command.glyph;
    button.title = command.title;
    button.setAttribute('aria-label', command.title);
    // Pressing a toolbar button must not steal focus, or the selection in the
    // textarea is lost before the command can act on it.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => run(textarea, command));
    bar.appendChild(button);
  }

  textarea.addEventListener('keydown', (event) => {
    if (!event.metaKey && !event.ctrlKey) return;
    const command = COMMANDS.find((entry) => entry.shortcut === event.key.toLowerCase());
    if (!command) return;
    event.preventDefault();
    run(textarea, command);
  });

  return bar;
}
