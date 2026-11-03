import { describe, expect, it } from 'vitest';
import { parseCommitUrl, parsePullRequestUrl } from '@shared/githubHost';
import { refOf, sideLabels } from '@shared/github';
import type { DiffTarget } from '@shared/github';

describe('parseCommitUrl', () => {
  it('reads a commit page', () => {
    expect(
      parseCommitUrl('https://github.com/own/repo/commit/c5d7dbdde8d8739012cf48187511641f732548b8'),
    ).toEqual({
      host: 'github.com',
      owner: 'own',
      repo: 'repo',
      sha: 'c5d7dbdde8d8739012cf48187511641f732548b8',
    });
  });

  it('accepts an abbreviated sha and a trailing segment', () => {
    expect(parseCommitUrl('https://ghe.example.com/o/r/commit/abc1234#diff-1')?.sha).toBe(
      'abc1234',
    );
  });

  it('is not fooled by a pull request commit page', () => {
    // That page's comments are review comments on the pull request, so
    // treating it as a bare commit would post them to the wrong place.
    expect(parseCommitUrl('https://github.com/own/repo/pull/7/commits/abc1234')).toBeNull();
  });

  it('rejects the commit list and anything that is not a sha', () => {
    expect(parseCommitUrl('https://github.com/own/repo/commits/main')).toBeNull();
    expect(parseCommitUrl('https://github.com/own/repo/commit/main')).toBeNull();
    expect(parseCommitUrl('https://github.com/own/repo/commit/abc12')).toBeNull();
  });

  it('does not claim a pull request', () => {
    expect(parseCommitUrl('https://github.com/own/repo/pull/7/files')).toBeNull();
    expect(parsePullRequestUrl('https://github.com/own/repo/commit/abc1234')).toBeNull();
  });
});

const COMMIT: DiffTarget = {
  kind: 'commit',
  host: 'github.com',
  owner: 'own',
  repo: 'repo',
  number: null,
  title: 'Describe design decisions',
  baseSha: '629ae3df6350476cd8161df16c608226c2cb831c',
  headSha: 'c5d7dbdde8d8739012cf48187511641f732548b8',
  headOwner: 'own',
  headRepo: 'repo',
};

describe('diff target identity', () => {
  it('keys a commit by its sha and a pull request by its number', () => {
    expect(refOf(COMMIT)).toBe(COMMIT.headSha);
    expect(refOf({ ...COMMIT, kind: 'pull', number: 7 })).toBe('pull/7');
  });

  it('calls the left side the parent for a commit, not the base', () => {
    expect(sideLabels(COMMIT)).toEqual({ base: 'Parent · 629ae3d', head: 'Commit · c5d7dbd' });
    expect(sideLabels({ ...COMMIT, kind: 'pull', number: 7 })).toEqual({
      base: 'Base · 629ae3d',
      head: 'Head · c5d7dbd',
    });
  });

  it('says so when a root commit has no parent', () => {
    expect(sideLabels({ ...COMMIT, baseSha: '' }).base).toBe('No parent');
  });
});
