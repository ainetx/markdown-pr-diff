// Copies the static extension files that Vite does not emit into dist/.
import { cpSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

if (!existsSync(dist)) {
  throw new Error('dist/ does not exist — run the vite builds before copying static files');
}

// The source manifest lives under src/ on purpose: with it in the repo root,
// pointing Chrome's "Load unpacked" at the root would half-work and fail with
// a confusing "could not load content.js" instead of being plainly invalid.
copyFileSync(new URL('src/manifest.json', root), new URL('manifest.json', dist));
mkdirSync(new URL('icons/', dist), { recursive: true });
cpSync(new URL('icons/', root), new URL('icons/', dist), { recursive: true });
copyFileSync(new URL('LICENSE', root), new URL('LICENSE', dist));
copyFileSync(new URL('NOTICE', root), new URL('NOTICE', dist));

console.log('static files copied into dist/');
