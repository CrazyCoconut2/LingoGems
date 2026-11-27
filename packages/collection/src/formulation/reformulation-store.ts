/** One span a suggestion changes, and why. */
export type ReformulationChange = {
  wrote: string;
  reformulation: string;
  reason: string;
};

export type ReformulationMark =
  { kind: 'text'; text: string } | { kind: 'change'; wrote: string; reformulation: string };

/** The suggestion, with each changed span shown as the words that were written beside the new wording. */
export function reformulationMarks(
  sentence: string,
  changes: readonly ReformulationChange[],
): ReformulationMark[] {
  const text = sentence;
  if (!text) return [];
  const ranges: { start: number; end: number; wrote: string; reformulation: string }[] = [];
  for (const change of changes) {
    const reformulation = change.reformulation.trim();
    const wrote = change.wrote.trim();
    if (!reformulation || !wrote || wrote === reformulation) continue;
    const found = findSpan(text, reformulation, ranges);
    if (!found) continue;
    ranges.push({ ...found, wrote, reformulation });
  }
  ranges.sort((left, right) => left.start - right.start);
  const marks: ReformulationMark[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) marks.push({ kind: 'text', text: text.slice(cursor, range.start) });
    marks.push({
      kind: 'change',
      wrote: range.wrote,
      reformulation: text.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  if (cursor < text.length) marks.push({ kind: 'text', text: text.slice(cursor) });
  return marks.length ? marks : [{ kind: 'text', text }];
}

function findSpan(
  text: string,
  needle: string,
  taken: readonly { start: number; end: number }[],
): { start: number; end: number } | null {
  return nextMatch(text, needle, taken, false) ?? nextMatch(text, needle, taken, true);
}

function nextMatch(
  text: string,
  needle: string,
  taken: readonly { start: number; end: number }[],
  ignoreCase: boolean,
): { start: number; end: number } | null {
  const hay = ignoreCase ? text.toLowerCase() : text;
  const pin = ignoreCase ? needle.toLowerCase() : needle;
  let from = 0;
  while (from < hay.length) {
    const start = hay.indexOf(pin, from);
    if (start < 0) return null;
    const end = start + needle.length;
    const overlaps = taken.some((range) => start < range.end && end > range.start);
    if (!overlaps && bounded(text, start, end)) return { start, end };
    from = start + 1;
  }
  return null;
}

function bounded(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(char: string): boolean {
  return char !== '' && /[\p{L}\p{N}'’\-]/u.test(char);
}
