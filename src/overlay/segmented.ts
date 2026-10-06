/**
 * A segmented control: every choice visible, the current one highlighted.
 *
 * Built as a radio group rather than a row of toggle buttons, because that is
 * what it is — the options are mutually exclusive. That also gets the
 * keyboard behaviour people expect for free: one tab stop for the whole
 * group, arrow keys to move between the options.
 */

export interface Segment<T extends string> {
  value: T;
  /** Short mark shown in the control. */
  glyph: string;
  /** What the option means, for the tooltip and for screen readers. */
  label: string;
}

export interface SegmentedControl<T extends string> {
  root: HTMLElement;
  setValue(value: T): void;
  destroy(): void;
}

export interface SegmentedOptions<T extends string> {
  doc: Document;
  /** Names the group as a whole. */
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange(value: T): void;
}

export function createSegmentedControl<T extends string>(
  options: SegmentedOptions<T>,
): SegmentedControl<T> {
  const { doc } = options;

  const root = doc.createElement('div');
  root.className = 'mdpd-segmented';
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', options.label);

  let current = options.value;
  const buttons = new Map<T, HTMLButtonElement>();

  function paint(): void {
    for (const [value, button] of buttons) {
      const selected = value === current;
      button.setAttribute('aria-checked', String(selected));
      // One tab stop for the group: tab reaches the selected option, arrows
      // move within.
      button.tabIndex = selected ? 0 : -1;
    }
  }

  function select(value: T, focus: boolean): void {
    if (focus) buttons.get(value)?.focus();
    if (value === current) return;
    current = value;
    paint();
    options.onChange(value);
  }

  function move(step: number): void {
    const values = options.segments.map((segment) => segment.value);
    const index = values.indexOf(current);
    const next = values[(index + step + values.length) % values.length];
    if (next !== undefined) select(next, true);
  }

  for (const segment of options.segments) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'mdpd-segment';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', segment.label);
    button.title = segment.label;
    button.textContent = segment.glyph;
    button.addEventListener('click', () => select(segment.value, false));
    buttons.set(segment.value, button);
    root.appendChild(button);
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
    else if (event.key === 'Home') select(options.segments[0]!.value, true);
    else if (event.key === 'End')
      select(options.segments[options.segments.length - 1]!.value, true);
    else return;
    event.preventDefault();
  });

  paint();

  return {
    root,
    setValue(value: T) {
      current = value;
      paint();
    },
    destroy: () => root.remove(),
  };
}
