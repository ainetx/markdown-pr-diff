import { resolve } from 'node:path';

export const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@overlay': resolve(import.meta.dirname, 'src/overlay'),
};

/**
 * Build identity, injected into every bundle.
 *
 * Assembled from the parts rather than sliced out of a localized string: the
 * length of that string depends on the locale data, and a single-digit hour
 * made the slice cut the stamp short.
 */
function buildStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(pad).join(':');
  return `${date} ${time}`;
}

export const define = {
  __MDPD_BUILD__: JSON.stringify(buildStamp()),
};
