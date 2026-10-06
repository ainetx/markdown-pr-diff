import { resolve } from 'node:path';

export const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@overlay': resolve(import.meta.dirname, 'src/overlay'),
};

/** Build identity, injected into every bundle. */
export const define = {
  __MDPD_BUILD__: JSON.stringify(
    new Date().toLocaleString('sv-SE', { timeZoneName: 'short' }).slice(0, 19),
  ),
};
