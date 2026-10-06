/**
 * Keeping the overlay's typing to itself.
 *
 * GitHub binds single-letter shortcuts on the document — `s` opens search,
 * `t` the file finder — and skips them when the event came from an input.
 * That check fails for us: a key pressed in the overlay's textarea is
 * retargeted to the shadow host as it crosses the shadow boundary, so by the
 * time GitHub sees it the target looks like an ordinary div and the shortcut
 * fires. Typing "Test" into a comment would open the search panel behind the
 * overlay.
 *
 * Stopping propagation at the host leaves everything inside the overlay
 * working and nothing escaping it.
 */

const KEYBOARD_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

export function containKeyboardEvents(host: HTMLElement): () => void {
  const block = (event: Event) => event.stopPropagation();

  for (const type of KEYBOARD_EVENTS) {
    host.addEventListener(type, block);
  }

  return () => {
    for (const type of KEYBOARD_EVENTS) {
      host.removeEventListener(type, block);
    }
  };
}
