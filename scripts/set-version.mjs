/**
 * Stamps a version into a built manifest.
 *
 * The Chrome Web Store refuses an upload whose version is not strictly
 * greater than the last one, so the number has to be monotonic and it has to
 * be decided by the build rather than by whoever remembered to edit a file.
 *
 * Chrome accepts one to four dot-separated integers, each 0-65535, with no
 * leading zeros — which is what lets CI append a run number to the release
 * version and still produce something the store will take.
 *
 * Writes dist/manifest.json by default, leaving the source manifest alone so
 * a CI build never dirties the repository.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , versionArg, targetArg] = process.argv;
const target = targetArg ?? new URL('../dist/manifest.json', import.meta.url);

if (!versionArg) {
  console.error('usage: set-version.mjs <version> [manifest path]');
  process.exit(1);
}

const version = versionArg.replace(/^v/, '');

if (!/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(version)) {
  console.error(
    `"${version}" is not a Chrome extension version: one to four dot-separated ` +
      'integers, no leading zeros.',
  );
  process.exit(1);
}

if (version.split('.').some((part) => Number(part) > 65535)) {
  console.error(`"${version}" has a part above 65535, which Chrome rejects.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(target, 'utf8'));
manifest.version = version;
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`manifest version set to ${version}`);
