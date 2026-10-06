/**
 * Text transformations behind the markdown toolbar.
 *
 * Kept as pure functions over (text, selection) so the fiddly parts — where
 * the caret lands, what happens with no selection, what a second press does —
 * can be pinned down by tests instead of discovered by hand in a textarea.
 */

export interface Selection {
  text: string;
  start: number;
  end: number;
}

/**
 * Wraps the selection in a marker, or removes the marker if it is already
 * there. Pressing bold twice should leave the text as it was found.
 */
export function toggleWrap(selection: Selection, marker: string, closing = marker): Selection {
  const { text, start, end } = selection;
  const selected = text.slice(start, end);

  const alreadyInside =
    text.slice(start - marker.length, start) === marker &&
    text.slice(end, end + closing.length) === closing;

  if (alreadyInside) {
    return {
      text: text.slice(0, start - marker.length) + selected + text.slice(end + closing.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }

  if (
    selected.startsWith(marker) &&
    selected.endsWith(closing) &&
    selected.length > marker.length + closing.length
  ) {
    const inner = selected.slice(marker.length, selected.length - closing.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }

  return {
    text: text.slice(0, start) + marker + selected + closing + text.slice(end),
    // With nothing selected the caret belongs between the markers, ready to type.
    start: start + marker.length,
    end: end + marker.length,
  };
}

/** Start and end offsets of the lines the selection touches. */
function lineBounds(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  return { from, to: lineEnd === -1 ? text.length : lineEnd };
}

/**
 * Puts a prefix on every selected line, or takes it off if every line already
 * has it. `numbered` renumbers instead of repeating the same marker.
 */
export function togglePrefix(
  selection: Selection,
  prefix: string,
  options: { numbered?: boolean } = {},
): Selection {
  const { text, start, end } = selection;
  const { from, to } = lineBounds(text, start, end);
  const lines = text.slice(from, to).split('\n');

  const matcher = options.numbered ? /^\d+\.\s/ : null;
  const allPrefixed = lines.every((line) =>
    matcher ? matcher.test(line) : line.startsWith(prefix),
  );

  const updated = lines.map((line, index) => {
    if (allPrefixed) {
      return matcher ? line.replace(matcher, '') : line.slice(prefix.length);
    }
    return options.numbered ? `${index + 1}. ${line}` : prefix + line;
  });

  const replacement = updated.join('\n');
  const delta = replacement.length - (to - from);

  return {
    text: text.slice(0, from) + replacement + text.slice(to),
    start: from,
    end: to + delta,
  };
}

/** Inserts a link, leaving the caret where the URL goes. */
export function insertLink(selection: Selection): Selection {
  const { text, start, end } = selection;
  const selected = text.slice(start, end);
  const label = selected || 'text';
  const inserted = `[${label}](url)`;

  const urlStart = start + label.length + 3;
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    start: urlStart,
    end: urlStart + 3,
  };
}

/** Wraps the selection in a fenced block on lines of its own. */
export function insertCodeBlock(selection: Selection): Selection {
  const { text, start, end } = selection;
  const selected = text.slice(start, end);
  const leadingBreak = start === 0 || text[start - 1] === '\n' ? '' : '\n';
  const inserted = `${leadingBreak}\`\`\`\n${selected}\n\`\`\`\n`;

  // Caret goes on the language line, which is the first thing one types.
  const caret = start + leadingBreak.length + 3;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: caret, end: caret };
}
