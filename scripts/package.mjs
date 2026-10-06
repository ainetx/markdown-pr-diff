// Zips dist/ into an uploadable extension archive named after the manifest version.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
const out = `markdown-pr-diff-${manifest.version}.zip`;

// Source maps stay in dist/ for debugging an unpacked load, but shipping a
// megabyte of them to the store helps nobody.
execFileSync('zip', ['-r', '-q', `../${out}`, '.', '-x', '*.map'], {
  cwd: new URL('../dist/', import.meta.url),
  stdio: 'inherit',
});
console.log(`packaged ${out}`);
