/**
 * Build-time configuration.
 *
 * The OAuth client id is public by design — the device flow exists precisely
 * so that a client with no secret can obtain a token. It still has to be
 * registered once: create an OAuth App, tick "Enable Device Flow", and build
 * with VITE_GITHUB_CLIENT_ID set. Without it the extension falls back to a
 * manually pasted personal access token and says so in the options page.
 */

export const GITHUB_CLIENT_ID: string = import.meta.env?.VITE_GITHUB_CLIENT_ID ?? '';

/** Scopes requested during the device flow: read the PR, write review comments. */
export const OAUTH_SCOPES = 'repo';

export const EXTENSION_NAME = 'Markdown PR Diff';

/**
 * When this bundle was built.
 *
 * Shown in the popup and on the overlay's title so the running build can be
 * identified at a glance, instead of being inferred from behaviour.
 */
export const BUILD_STAMP: string = __MDPD_BUILD__;
