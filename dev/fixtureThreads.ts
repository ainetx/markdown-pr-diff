/**
 * Synthetic review threads for the playground, so the comment layer can be
 * worked on without a live pull request.
 */

import type { ReviewThread } from '@shared/github';

const now = Date.now();

function comment(id: number, login: string, body: string, minutesAgo: number, mine = false) {
  return {
    id: `C${id}`,
    databaseId: id,
    author: {
      login,
      avatarUrl: `https://avatars.githubusercontent.com/u/${id}?s=40`,
      url: `https://github.com/${login}`,
    },
    bodyMarkdown: body,
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
    url: 'https://github.com/example/repo/pull/1#discussion_r1',
    viewerDidAuthor: mine,
  };
}

export function fixtureThreads(path: string): ReviewThread[] {
  return [
    {
      id: 'T1',
      path,
      line: 3,
      startLine: null,
      originalLine: 3,
      side: 'RIGHT',
      startSide: null,
      isResolved: false,
      isOutdated: false,
      viewerCanResolve: true,
      viewerCanUnresolve: true,
      diffHunk: '',
      comments: [
        comment(1, 'reviewer', 'This wording is doing a lot of work. Can we split it?', 42),
        comment(2, 'author', 'Fair — rewritten in the next push.', 20, true),
      ],
    },
    {
      id: 'T2',
      path,
      line: 7,
      startLine: null,
      originalLine: 7,
      side: 'RIGHT',
      startSide: null,
      isResolved: true,
      isOutdated: false,
      viewerCanResolve: false,
      viewerCanUnresolve: true,
      diffHunk: '',
      comments: [comment(3, 'reviewer', 'Table header looks right now. 👍', 180)],
    },
    {
      id: 'T3',
      path,
      line: null,
      startLine: null,
      originalLine: 4,
      side: 'LEFT',
      startSide: null,
      isResolved: false,
      isOutdated: true,
      viewerCanResolve: true,
      viewerCanUnresolve: false,
      diffHunk: '@@ -1,6 +1,6 @@\n # Guide\n \n-Old sentence.\n+New sentence.',
      comments: [comment(4, 'reviewer', 'This paragraph has since been rewritten.', 600)],
    },
  ];
}
