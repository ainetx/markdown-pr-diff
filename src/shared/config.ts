/**
 * Build-time configuration.
 *
 * The OAuth client id is public by design — the device flow exists precisely
 * so that a client with no secret can obtain a token, and GitHub treats the id
 * as public information. So this project's own registered app is the default,
 * and a build needs no configuration to offer "Connect GitHub".
 *
 * A fork, or an installation that would rather authorize its own app, sets
 * VITE_GITHUB_CLIENT_ID at build time. An empty value counts as unset, because
 * both the Makefile and CI pass the variable through whether or not anyone
 * filled it in.
 */

const DEFAULT_CLIENT_ID = 'Ov23liz42ed6ltDUD67F';

export const GITHUB_CLIENT_ID: string = import.meta.env?.VITE_GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;

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
