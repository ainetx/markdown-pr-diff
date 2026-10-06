import { describe, expect, it } from 'vitest';
import { wholeFileKind } from '@overlay/view';

describe('wholeFileKind', () => {
  it('calls a file with no base version added', () => {
    expect(wholeFileKind('', '# New\n')).toBe('added');
  });

  it('calls a file with no head version removed', () => {
    expect(wholeFileKind('# Gone\n', '')).toBe('removed');
  });

  it('calls an edited file neither', () => {
    expect(wholeFileKind('a\n', 'b\n')).toBeNull();
  });

  it('treats two empty sides as neither, so nothing special is claimed', () => {
    expect(wholeFileKind('', '')).toBeNull();
  });
});
