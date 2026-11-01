import type { StoredElement } from './element-store';

export const ELEMENT_FACETS = ['definitions', 'forms', 'examples'] as const;

export type ElementFacet = (typeof ELEMENT_FACETS)[number];

export const ELEMENT_SORTS = [
  'title-asc',
  'title-desc',
  'created-desc',
  'created-asc',
  'definitions-desc',
  'examples-desc',
  'none',
] as const;

export type ElementSort = (typeof ELEMENT_SORTS)[number];

export const DEFAULT_ELEMENT_SORT: ElementSort = 'created-desc';

const FACET_SET = new Set<string>(ELEMENT_FACETS);
const SORT_SET = new Set<string>(ELEMENT_SORTS);

export function parseElementFacets(raw: string | null): ElementFacet[] {
  if (!raw) return [];
  const chosen = new Set<ElementFacet>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (FACET_SET.has(value)) chosen.add(value as ElementFacet);
  }
  return ELEMENT_FACETS.filter((facet) => chosen.has(facet));
}

export function parseElementSort(raw: string | null): ElementSort {
  if (raw && SORT_SET.has(raw)) return raw as ElementSort;
  return DEFAULT_ELEMENT_SORT;
}

export function elementFacetCount(element: StoredElement, facet: ElementFacet): number {
  if (facet === 'definitions') return element.definitions.length;
  if (facet === 'forms') {
    return element.definitions.reduce((count, definition) => count + definition.forms.length, 0);
  }
  return element.definitions.reduce((count, definition) => count + definition.examples.length, 0);
}

/** Include keeps an element that has any chosen facet. Exclude hides an element that has any chosen facet. */
export function elementMatchesFacets(
  element: StoredElement,
  include: readonly ElementFacet[],
  exclude: readonly ElementFacet[],
): boolean {
  const has = (facet: ElementFacet) => elementFacetCount(element, facet) > 0;
  if (exclude.some(has)) return false;
  if (include.length > 0 && !include.some(has)) return false;
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
  const facet = sort === 'definitions-desc' ? 'definitions' : 'examples';
  const diff = elementFacetCount(left, facet) - elementFacetCount(right, facet);
  return -diff || title;
}
