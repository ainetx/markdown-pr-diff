import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchNavigation } from '../../src/content/nav';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchNavigation', () => {
  it('runs once immediately on start', async () => {
    const run = vi.fn();
    const watcher = watchNavigation(run);
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  // MutationObserver delivers its records as a microtask, so these have to be
  // async: a synchronous timer advance never lets the callback run.
  it('coalesces a burst of mutations into one run', async () => {
    const run = vi.fn();
    const watcher = watchNavigation(run, { debounceMs: 100, maxWaitMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    run.mockClear();

    for (let i = 0; i < 10; i++) document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(200);

    expect(run).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('still runs when mutations never stop arriving', async () => {
    // The real failure: a pull request page mutates continuously, so a plain
    // debounce resets forever and the work never happens at all.
    const run = vi.fn();
    const watcher = watchNavigation(run, { debounceMs: 150, maxWaitMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    run.mockClear();

    for (let tick = 0; tick < 40; tick++) {
      document.body.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(50); // faster than the debounce window
    }

    // 40 ticks of 50ms is two seconds; with a 1s ceiling it must have run.
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(1);
    watcher.stop();
  });

  it('reacts to turbo navigation', async () => {
    const run = vi.fn();
    const watcher = watchNavigation(run, { debounceMs: 100, maxWaitMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    run.mockClear();

    window.dispatchEvent(new Event('turbo:load'));
    await vi.advanceTimersByTimeAsync(200);

    expect(run).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('goes quiet after stop', async () => {
    const run = vi.fn();
    const watcher = watchNavigation(run, { debounceMs: 100, maxWaitMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    watcher.stop();
    run.mockClear();

    document.body.appendChild(document.createElement('div'));
    window.dispatchEvent(new Event('turbo:load'));
    await vi.advanceTimersByTimeAsync(2000);

    expect(run).not.toHaveBeenCalled();
  });
});
