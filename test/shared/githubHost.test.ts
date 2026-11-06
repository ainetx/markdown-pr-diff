import { describe, expect, it } from 'vitest';
import { parseCommitUrl, parsePullRequestRange, parsePullRequestUrl } from '@shared/githubHost';
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
  baseOwner: 'own',
  baseRepo: 'repo',
  headOwner: 'own',
  headRepo: 'repo',
  range: false,
  commentingDisabledReason: null,
};

describe('parsePullRequestRange', () => {
  const url =
    'https://github.com/own/repo/pull/5729/changes/a0adcdeb3a025a9aa58c97aefb7336c5568c6540..d515f90f57432af61fc5051a1a607e9adbc6d465';

  it('reads the two commits a range view is showing', () => {
    expect(parsePullRequestRange(url)).toEqual({
      host: 'github.com',
      owner: 'own',
      repo: 'repo',
      number: 5729,
      base: 'a0adcdeb3a025a9aa58c97aefb7336c5568c6540',
      head: 'd515f90f57432af61fc5051a1a607e9adbc6d465',
    });
  });

  it('reads the files tab and the three-dot spelling too', () => {
    expect(
      parsePullRequestRange('https://github.com/o/r/pull/1/files/aaaaaaa..bbbbbbb')?.base,
    ).toBe('aaaaaaa');
    expect(
      parsePullRequestRange('https://github.com/o/r/pull/1/files/aaaaaaa...bbbbbbb')?.head,
    ).toBe('bbbbbbb');
  });

  it('does not match a whole pull request', () => {
    expect(parsePullRequestRange('https://github.com/o/r/pull/1/files')).toBeNull();
    expect(parsePullRequestRange('https://github.com/o/r/pull/1/changes')).toBeNull();
  });

  it('is a pull request url too, which is why order matters at the call site', () => {
    // parsePullRequestUrl also matches it; whoever asks first wins, and the
    // looser answer would quietly show the whole pull request.
    expect(parsePullRequestUrl(url)?.number).toBe(5729);
  });
});

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

describe('range identity', () => {
  const RANGE: DiffTarget = {
    ...COMMIT,
    kind: 'pull',
    number: 5729,
    range: true,
    baseSha: 'a0adcdeb3a025a9aa58c97aefb7336c5568c6540',
    headSha: 'd515f90f57432af61fc5051a1a607e9adbc6d465',
  };

  it('keys apart from the whole pull request, so their patches cannot be confused', () => {
    expect(refOf(RANGE)).not.toBe(refOf({ ...RANGE, range: false }));
    expect(refOf(RANGE)).toContain('pull/5729/');
  });

  it('does not call either side Base or Head, because neither is', () => {
    expect(sideLabels(RANGE)).toEqual({ base: 'Since · a0adcde', head: 'Up to · d515f90' });
  });
});
