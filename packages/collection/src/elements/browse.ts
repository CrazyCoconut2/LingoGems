import { type ElementMode, type StoredElement } from './element-store';

export const ELEMENT_SORTS = [
  'title-asc',
  'title-desc',
  'created-desc',
  'created-asc',
  'definitions-desc',
  'translations-desc',
  'none',
] as const;

export type ElementSort = (typeof ELEMENT_SORTS)[number];

export const DEFAULT_ELEMENT_SORT: ElementSort = 'created-desc';

const SORT_SET = new Set<string>(ELEMENT_SORTS);

export function parseElementSort(raw: string | null): ElementSort {
  if (raw && SORT_SET.has(raw)) return raw as ElementSort;
  return DEFAULT_ELEMENT_SORT;
}

/** A missing or invalid value means no minimum. */
export function parseElementMinimum(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return Math.min(value, 99);
}

export function elementTranslationCount(element: StoredElement): number {
  return element.equivalents.length;
}

export function elementDefinitionCount(element: StoredElement): number {
  return element.definitions.length;
}

/** `1`, `2`, or `3`. Anything else means every mode. */
export function parseElementMode(raw: string | null): ElementMode | null {
  const mode = Number(raw);
  return mode === 1 || mode === 2 || mode === 3 ? mode : null;
}

/** Keep an element in the chosen mode. A missing mode keeps every element. */
export function elementMatchesMode(element: StoredElement, mode: ElementMode | null): boolean {
  return mode == null || element.mode === mode;
}

/** Keep an element whose translation and definition counts meet each minimum. */
export function elementMatchesMinimums(
  element: StoredElement,
  translations: number | null,
  definitions: number | null,
): boolean {
  if (translations != null && elementTranslationCount(element) < translations) return false;
  if (definitions != null && elementDefinitionCount(element) < definitions) return false;
  return true;
}

export function compareElements(
  left: StoredElement,
  right: StoredElement,
  sort: ElementSort,
): number {
  const title = left.title.localeCompare(right.title);
  if (sort === 'none' || sort === 'title-asc') return title;
  if (sort === 'title-desc') return -title;
  if (sort === 'created-desc' || sort === 'created-asc') {
    const diff = left.createdAt - right.createdAt;
    return (sort === 'created-desc' ? -diff : diff) || title;
  }
  const count = sort === 'definitions-desc' ? elementDefinitionCount : elementTranslationCount;
  return count(right) - count(left) || title;
}
