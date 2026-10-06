import { describe, expect, it } from 'vitest';
import { computeDocumentDiff } from '@core/blockDiff';

const lines = (...rows: string[]) => rows.join('\n') + '\n';

describe('computeDocumentDiff', () => {
  it('reports no regions for identical documents', () => {
    const text = lines('# Title', '', 'Body');
    const diff = computeDocumentDiff(text, text);
    expect(diff.unchanged).toBe(true);
    expect(diff.regions).toEqual([]);
  });

  it('pairs a deletion followed by an insertion into one modified region', () => {
    const before = lines('alpha', 'beta', 'gamma');
    const after = lines('alpha', 'BETA', 'gamma');
    const { regions } = computeDocumentDiff(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      kind: 'modified',
      old: { start: 2, end: 2 },
      new: { start: 2, end: 2 },
    });
  });

  it('tracks line numbers across an insertion that shifts the tail', () => {
    const before = lines('one', 'two', 'three');
    const after = lines('one', 'inserted', 'two', 'three');
    const { regions } = computeDocumentDiff(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('added');
    expect(regions[0]!.old).toBeNull();
    expect(regions[0]!.new).toEqual({ start: 2, end: 2 });
  });

  it('reports a pure deletion with no new range', () => {
    const before = lines('one', 'two', 'three');
    const after = lines('one', 'three');
    const { regions } = computeDocumentDiff(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('removed');
    expect(regions[0]!.old).toEqual({ start: 2, end: 2 });
    expect(regions[0]!.new).toBeNull();
  });

  it('covers the whole document when a file is added', () => {
    const after = lines('one', 'two');
    const { regions } = computeDocumentDiff('', after);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('added');
    expect(regions[0]!.new).toEqual({ start: 1, end: 2 });
  });

  it('covers the whole document when a file is deleted', () => {
    const before = lines('one', 'two');
    const { regions } = computeDocumentDiff(before, '');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('removed');
    expect(regions[0]!.old).toEqual({ start: 1, end: 2 });
  });

  it('gives every region a distinct pair id', () => {
    const before = lines('a', 'b', 'c', 'd', 'e');
    const after = lines('a', 'B', 'c', 'D', 'e');
    const { regions } = computeDocumentDiff(before, after);

    expect(regions.length).toBeGreaterThan(1);
    expect(new Set(regions.map((r) => r.pairId)).size).toBe(regions.length);
  });

  it('keeps old and new line counters independent for uneven modifications', () => {
    const before = lines('a', 'x', 'b');
    const after = lines('a', 'y', 'z', 'w', 'b');
    const { regions } = computeDocumentDiff(before, after);

    const modified = regions.find((r) => r.kind === 'modified');
    expect(modified).toBeDefined();
    expect(modified!.old).toEqual({ start: 2, end: 2 });
    expect(modified!.new).toEqual({ start: 2, end: 4 });
  });
});
