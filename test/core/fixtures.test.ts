import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { panesOf, renderStandalone, stripDiffMarks } from './structuralIntegrity';

// vitest runs from the project root; import.meta.url is not a file: URL under jsdom.
const DIR = join(process.cwd(), 'test', 'fixtures');

function fixtureNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(DIR)) {
    const match = /^(.+)\.before\.md$/.exec(file);
    if (match) names.add(match[1]!);
  }
  return [...names].sort();
}

const read = (name: string, kind: 'before' | 'after') =>
  readFileSync(join(DIR, `${name}.${kind}.md`), 'utf8');

const names = fixtureNames();

describe('fixtures', () => {
  it('found the fixture set', () => {
    expect(names.length).toBeGreaterThan(5);
  });

  describe.each(names)('%s', (name) => {
    const before = read(name, 'before');
    const after = read(name, 'after');

    it('renders each side exactly as that document renders on its own', () => {
      const { before: oldPane, after: newPane } = panesOf(before, after);
      expect(stripDiffMarks(oldPane)).toBe(renderStandalone(before));
      expect(stripDiffMarks(newPane)).toBe(renderStandalone(after));
    });

    it('marks something when the documents differ, and nothing when they do not', () => {
      const { before: oldPane, after: newPane, result } = panesOf(before, after);
      const markCount =
        oldPane.querySelectorAll('.diff-removed-block').length +
        newPane.querySelectorAll('.diff-added-block').length;

      if (before === after) expect(markCount).toBe(0);
      else expect(markCount).toBeGreaterThan(0);

      expect(result.diff.unchanged).toBe(before === after);
    });

    it('never marks an element that contains another marked element', () => {
      const { before: oldPane, after: newPane } = panesOf(before, after);
      for (const pane of [oldPane, newPane]) {
        const marked = [...pane.querySelectorAll('.diff-added-block, .diff-removed-block')];
        for (const el of marked) {
          const nested = marked.filter((other) => other !== el && el.contains(other));
          expect(nested, `${el.tagName} wraps a marked descendant`).toHaveLength(0);
        }
      }
    });
  });
});
