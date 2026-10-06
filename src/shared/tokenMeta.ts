/** Non-secret description of a stored token, safe to show in the UI. */
export interface TokenMetaLike {
  host: string;
  login: string;
  scopes: string[];
  source: 'device-flow' | 'manual';
  obtainedAt: number;
}
