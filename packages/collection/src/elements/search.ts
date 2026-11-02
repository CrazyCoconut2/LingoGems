import { formTexts, type StoredElement } from './element-store';

const SEARCH_MIN_CHARS = 2;

export const ELEMENT_SEARCH_MAX_LENGTH = 100;

export type ElementSearch = {
  mode: 'browse' | 'prefix';
  /** Prefix text, or empty when every element is shown. */
  value: string;
};

/** Prefix browse only. Fewer than two characters shows the whole language. */
export function elementPrefixSearch(raw: string): ElementSearch {
  const value = raw.trim().slice(0, ELEMENT_SEARCH_MAX_LENGTH);
  if (value.length >= SEARCH_MIN_CHARS) return { mode: 'prefix', value };
  return { mode: 'browse', value: '' };
}

/** Title or any form starts with `prefix`, case-insensitively. */
export function elementMatchesPrefix(element: StoredElement, prefix: string): boolean {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return true;
  if (element.title.trim().toLowerCase().startsWith(needle)) return true;
  return element.definitions.some((definition) =>
    formTexts(definition.forms).some((form) => form.toLowerCase().startsWith(needle)),
  );
}

export type ElementSearchPart = { text: string; hit: boolean };

/** Split `text` into highlight parts for the active search. */
export function elementHighlightParts(text: string, search: ElementSearch): ElementSearchPart[] {
  if (!text) return [{ text: '', hit: false }];
  if (search.mode !== 'prefix') return [{ text, hit: false }];
  return highlightNeedle(text, search.value);
}

function highlightNeedle(text: string, needle: string): ElementSearchPart[] {
  const trimmed = needle.trim();
  if (!trimmed) return [{ text, hit: false }];
  const lowered = text.toLocaleLowerCase();
  const target = trimmed.toLocaleLowerCase();
  const parts: ElementSearchPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lowered.indexOf(target, cursor);
    if (index < 0) {
      parts.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), hit: false });
    parts.push({ text: text.slice(index, index + target.length), hit: true });
    cursor = index + target.length;
  }
  return parts.length ? parts : [{ text, hit: false }];
}
