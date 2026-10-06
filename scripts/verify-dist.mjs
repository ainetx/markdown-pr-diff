/**
 * Build-time check on dist/.
 *
 * Catches the failure mode a bundler rename produces: a manifest that points
 * at files which are not there. Chrome reports that only when the extension is
 * loaded by hand, which is far too late.
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const problems = [];

function requireFile(path, why) {
  if (!existsSync(join(dist, path))) problems.push(`${why}: dist/${path} is missing`);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

requireFile(manifest.background.service_worker, 'background.service_worker');
requireFile(manifest.options_ui.page, 'options_ui.page');
requireFile(manifest.action.default_popup, 'action.default_popup');

for (const script of manifest.content_scripts ?? []) {
  for (const file of script.js ?? []) requireFile(file, 'content_scripts.js');
  for (const file of script.css ?? []) requireFile(file, 'content_scripts.css');
}
for (const size of Object.keys(manifest.icons ?? {})) {
  requireFile(manifest.icons[size], `icons.${size}`);
}

if (manifest.background.type !== 'module') {
  problems.push('background.type must be "module": the worker is built as ESM');
}

// Every <script src> and <link href> an extension page points at.
function checkHtml(page) {
  const html = readFileSync(join(dist, page), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue;
    const resolved = ref.startsWith('/')
      ? ref.slice(1)
      : relative(dist, join(dist, page, '..', ref));
    requireFile(resolved, `${page} references ${ref}`);
  }
}
checkHtml(manifest.options_ui.page);
checkHtml(manifest.action.default_popup);

// Parse every emitted script. Copied to .mjs so node parses them as modules;
// the content script is an IIFE and is valid either way.
function collectJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectJs(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const staging = mkdtempSync(join(tmpdir(), 'mdpd-verify-'));
for (const file of collectJs(dist)) {
  const target = join(staging, `${relative(dist, file).replace(/[/\\]/g, '_')}.mjs`);
  copyFileSync(file, target);
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`${relative(dist, file)} does not parse: ${String(error)}`);
  }
}

// The content script is injected into a live page, where a throw at load time
// means the whole extension is silently inert. Evaluating the real bundle in a
// page-like environment turns that into a build failure instead.
async function checkContentScriptBoots() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://github.com/own/repo/pull/1/files',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const listeners = [];
  const area = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    setAccessLevel: async () => {},
  };
  dom.window.chrome = {
    storage: {
      local: area,
      sync: area,
      session: area,
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: {
      sendMessage: async () => undefined,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
  };

  try {
    dom.window.eval(readFileSync(join(dist, 'content.js'), 'utf8'));
  } catch (error) {
    problems.push(`content.js throws while loading: ${String(error)}`);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  if (listeners.length === 0) {
    problems.push('content.js loaded but registered no runtime.onMessage listener');
  }
  dom.window.close();
}

await checkContentScriptBoots();

if (problems.length > 0) {
  console.error('dist/ verification failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('dist/ verified: manifest resolves, scripts parse, content script boots');
