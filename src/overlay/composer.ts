/**
 * The write / preview box used for new comments and replies.
 */

import type { ReferenceContext } from '@core/githubFlavour';
import { renderMarkdownFragment } from '@core/renderMarkdown';
import { createMarkdownToolbar } from './markdownToolbar';
import { clearDraft, readDraft, writeDraft, type DraftKey } from './drafts';

export interface ComposerOptions {
  doc: Document;
  draftKey: DraftKey;
  submitLabel: string;
  placeholder: string;
  onSubmit(body: string): Promise<void>;
  onCancel(): void;
  /** Makes the preview link @mentions and #issues as the posted comment will. */
  references?: ReferenceContext;
}

export interface Composer {
  root: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createComposer(options: ComposerOptions): Composer {
  const { doc } = options;

  const root = doc.createElement('div');
  root.className = 'mdpd-composer';

  const tabs = doc.createElement('div');
  tabs.className = 'mdpd-composer-tabs';
  const writeTab = button(doc, 'Write', 'mdpd-tab');
  const previewTab = button(doc, 'Preview', 'mdpd-tab');
  writeTab.setAttribute('aria-pressed', 'true');
  tabs.append(writeTab, previewTab);

  const textarea = doc.createElement('textarea');
  textarea.className = 'mdpd-textarea';
  textarea.rows = 4;
  textarea.placeholder = options.placeholder;

  const formatBar = createMarkdownToolbar(doc, textarea);

  const preview = doc.createElement('div');
  preview.className = 'md-diff-doc mdpd-preview';
  preview.hidden = true;

  const error = doc.createElement('div');
  error.className = 'mdpd-error';
  error.hidden = true;

  const submit = button(doc, options.submitLabel, 'mdpd-btn mdpd-btn-primary');
  const cancel = button(doc, 'Cancel', 'mdpd-btn');
  const hint = doc.createElement('span');
  hint.className = 'mdpd-hint';
  hint.textContent = '⌘/Ctrl + Enter to submit';

  const actions = doc.createElement('div');
  actions.className = 'mdpd-composer-actions';
  actions.append(submit, cancel, hint);

  root.append(tabs, formatBar, textarea, preview, error, actions);

  void readDraft(options.draftKey).then((draft) => {
    if (draft && textarea.value === '') textarea.value = draft;
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void writeDraft(options.draftKey, textarea.value), 400);
  });

  function showWrite() {
    writeTab.setAttribute('aria-pressed', 'true');
    previewTab.setAttribute('aria-pressed', 'false');
    formatBar.hidden = false;
    textarea.hidden = false;
    preview.hidden = true;
  }

  function showPreview() {
    writeTab.setAttribute('aria-pressed', 'false');
    previewTab.setAttribute('aria-pressed', 'true');
    // Formatting applies to the text being written, not to the preview.
    formatBar.hidden = true;
    textarea.hidden = true;
    preview.hidden = false;
    preview.replaceChildren(
      textarea.value.trim()
        ? renderMarkdownFragment(textarea.value, doc, { references: options.references })
        : doc.createTextNode('Nothing to preview yet.'),
    );
  }

  writeTab.addEventListener('click', showWrite);
  previewTab.addEventListener('click', showPreview);

  let busy = false;
  async function doSubmit() {
    const body = textarea.value.trim();
    if (!body || busy) return;

    // Posting crosses the network; without a visible change the button looks
    // simply unresponsive and people click it again.
    busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    textarea.readOnly = true;
    root.classList.add('is-busy');
    submit.textContent = 'Posting…';
    error.hidden = true;

    try {
      await options.onSubmit(body);
      await clearDraft(options.draftKey);
    } catch (failure) {
      // The text stays exactly where the user left it; only the error is new.
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      error.hidden = false;
      showWrite();
    } finally {
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      textarea.readOnly = false;
      root.classList.remove('is-busy');
      submit.textContent = options.submitLabel;
    }
  }

  submit.addEventListener('click', () => void doSubmit());
  cancel.addEventListener('click', () => options.onCancel());
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void doSubmit();
    }
    if (event.key === 'Escape') {
      // Let the composer swallow Escape so it does not close the whole overlay.
      event.stopPropagation();
      options.onCancel();
    }
  });

  return {
    root,
    focus: () => textarea.focus(),
    destroy: () => {
      clearTimeout(saveTimer);
      root.remove();
    },
  };
}

function button(doc: Document, label: string, className: string): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}
