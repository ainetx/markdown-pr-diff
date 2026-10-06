/**
 * Standalone markdown rendering for comment bodies.
 *
 * Comment text is as untrusted as file content, so it goes through the same
 * renderer and the same sanitizer.
 */

import { linkGitHubReferences, type ReferenceContext } from './githubFlavour';
import { createRenderer, type MarkdownRenderer } from './markdownRenderer';
import { resolveRelativeUrls, type UrlBases } from './resolveUrls';
import { toSafeFragment } from './sanitize';

let shared: MarkdownRenderer | null = null;

export interface RenderMarkdownOptions {
  bases?: UrlBases;
  /** Enables @mention and #issue links, which need to know the repository. */
  references?: ReferenceContext;
}

export function renderMarkdownFragment(
  markdown: string,
  doc: Document = document,
  options: RenderMarkdownOptions = {},
): DocumentFragment {
  shared ??= createRenderer();
  const fragment = toSafeFragment(shared.render(markdown), doc);
  if (options.bases) resolveRelativeUrls(fragment, options.bases);
  if (options.references) linkGitHubReferences(fragment, options.references);
  return fragment;
}
