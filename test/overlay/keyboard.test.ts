import { afterEach, describe, expect, it, vi } from 'vitest';
import { containKeyboardEvents } from '@overlay/keyboard';

/**
 * Real keyboard events are composed, which is what lets them cross the shadow
 * boundary and reach the page at all. A synthetic event without that flag
 * never leaves the shadow root, and a test built on one proves nothing.
 */
function overlayHost() {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const textarea = document.createElement('textarea');
  shadow.appendChild(textarea);
  document.body.appendChild(host);
  return { host, textarea };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('containKeyboardEvents', () => {
  it('stops typing inside the overlay from reaching the page', () => {
    // Without this, typing "Test" in a comment triggers GitHub's own
    // single-letter shortcuts and opens panels behind the overlay.
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);

    const { host, textarea } = overlayHost();
    containKeyboardEvents(host);
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }),
    );

    expect(pageListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageListener);
  });

  it('leaves handlers inside the overlay working', () => {
    const inside = vi.fn();
    const { host, textarea } = overlayHost();
    containKeyboardEvents(host);
    textarea.addEventListener('keydown', inside);

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', bubbles: true, composed: true }),
    );
    expect(inside).toHaveBeenCalledTimes(1);
  });

  it('covers keypress and keyup as well as keydown', () => {
    const pageListener = vi.fn();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      document.addEventListener(type, pageListener);
    }

    const { host, textarea } = overlayHost();
    containKeyboardEvents(host);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      textarea.dispatchEvent(new KeyboardEvent(type, { key: 's', bubbles: true, composed: true }));
    }

    expect(pageListener).not.toHaveBeenCalled();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      document.removeEventListener(type, pageListener);
    }
  });

  it('lets the page hear keys again once released', () => {
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);

    const { host, textarea } = overlayHost();
    const release = containKeyboardEvents(host);
    release();
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }),
    );

    expect(pageListener).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', pageListener);
  });

  it('does not touch keys pressed outside the overlay', () => {
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);

    const { host } = overlayHost();
    containKeyboardEvents(host);
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }),
    );

    expect(pageListener).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', pageListener);
  });
});
