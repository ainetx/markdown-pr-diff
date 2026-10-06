import { describe, expect, it, vi } from 'vitest';
import { createSegmentedControl } from '@overlay/segmented';

type Layout = 'side-by-side' | 'unified' | 'document';

const SEGMENTS = [
  { value: 'side-by-side', glyph: '⇆', label: 'Side by side' },
  { value: 'unified', glyph: '≡', label: 'Unified' },
  { value: 'document', glyph: '▤', label: 'Reading view' },
] as const;

function build(value: Layout = 'side-by-side') {
  const onChange = vi.fn();
  const control = createSegmentedControl<Layout>({
    doc: document,
    label: 'Layout',
    segments: SEGMENTS,
    value,
    onChange,
  });
  document.body.replaceChildren(control.root);
  const buttons = [...control.root.querySelectorAll<HTMLButtonElement>('.mdpd-segment')];
  return { control, onChange, buttons };
}

const checked = (buttons: HTMLButtonElement[]) =>
  buttons.filter((b) => b.getAttribute('aria-checked') === 'true');

describe('createSegmentedControl', () => {
  it('shows every option, not just the current one', () => {
    const { buttons } = build();
    expect(buttons.map((b) => b.textContent)).toEqual(['⇆', '≡', '▤']);
  });

  it('marks exactly one option as current', () => {
    const { buttons } = build('unified');
    expect(checked(buttons)).toHaveLength(1);
    expect(checked(buttons)[0]!.textContent).toBe('≡');
  });

  it('reports a choice and moves the mark', () => {
    const { buttons, onChange } = build();
    buttons[2]!.click();

    expect(onChange).toHaveBeenCalledWith('document');
    expect(checked(buttons)[0]!.textContent).toBe('▤');
  });

  it('says nothing when the current option is clicked again', () => {
    const { buttons, onChange } = build('unified');
    buttons[1]!.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves between options with the arrow keys', () => {
    const { control, buttons, onChange } = build();
    control.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('unified');
    expect(checked(buttons)[0]!.textContent).toBe('≡');
  });

  it('wraps around at the ends', () => {
    const { control, onChange } = build('side-by-side');
    control.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onChange).toHaveBeenCalledWith('document');
  });

  it('jumps to the first and last option', () => {
    const { control, onChange } = build('unified');
    control.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('document');

    control.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('side-by-side');
  });

  it('keeps one tab stop for the whole group', () => {
    // Arrow keys move within a radio group; tab should not land on each option.
    const { buttons } = build('unified');
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('is a radio group, since the options are mutually exclusive', () => {
    const { control, buttons } = build();
    expect(control.root.getAttribute('role')).toBe('radiogroup');
    expect(control.root.getAttribute('aria-label')).toBe('Layout');
    expect(buttons.every((b) => b.getAttribute('role') === 'radio')).toBe(true);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Side by side',
      'Unified',
      'Reading view',
    ]);
  });

  it('can be set from outside without reporting a change', () => {
    const { control, buttons, onChange } = build();
    control.setValue('document');

    expect(checked(buttons)[0]!.textContent).toBe('▤');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores keys that are not navigation', () => {
    const { control, onChange } = build();
    control.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
