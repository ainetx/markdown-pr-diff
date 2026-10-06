/**
 * Re-running on GitHub's soft navigations and late renders.
 *
 * GitHub swaps the page without a reload, so a content script that only runs
 * once sees the wrong page almost immediately. Turbo and pjax events cover the
 * common transitions; the observer catches diff blocks that arrive long after
 * navigation settles.
 */

export interface NavWatcher {
  stop(): void;
}

export interface WatchOptions {
  /** Quiet period before running, to coalesce bursts of mutations. */
  debounceMs?: number;
  /**
   * Longest the run may be postponed. A pull request page mutates more or less
   * continuously — tooltips, timers, live updates — so a plain debounce can be
   * starved indefinitely and never fire at all. This bounds the wait.
   */
  maxWaitMs?: number;
}

export function watchNavigation(run: () => void, options: WatchOptions = {}): NavWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const maxWaitMs = options.maxWaitMs ?? 1000;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstRequestedAt: number | null = null;

  const fire = () => {
    clearTimeout(timer);
    timer = undefined;
    firstRequestedAt = null;
    run();
  };

  const schedule = () => {
    const now = Date.now();
    firstRequestedAt ??= now;

    if (now - firstRequestedAt >= maxWaitMs) {
      fire();
      return;
    }

    clearTimeout(timer);
    const remaining = Math.max(0, maxWaitMs - (now - firstRequestedAt));
    timer = setTimeout(fire, Math.min(debounceMs, remaining));
  };

  const events = ['turbo:load', 'turbo:render', 'turbo:frame-render', 'pjax:end', 'popstate'];
  for (const event of events) window.addEventListener(event, schedule);

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  schedule();

  return {
    stop() {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, schedule);
      observer.disconnect();
    },
  };
}
