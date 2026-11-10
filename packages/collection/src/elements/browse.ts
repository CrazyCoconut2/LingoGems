import { type ElementMode, type StoredElement } from './element-store';
import {
  normalizeMetadataVariability,
  type ElementMetadataVariability,
} from './metadata-variability';

export const ELEMENT_SORTS = [
  'title-asc',
  'title-desc',
  'created-desc',
  'created-asc',
  'definitions-desc',
  'translations-desc',
  'clicks-desc',
  'clicks-asc',
  'gems-desc',
  'gems-asc',
  'none',
] as const;

export type ElementSort = (typeof ELEMENT_SORTS)[number];

export const DEFAULT_ELEMENT_SORT: ElementSort = 'created-desc';

const COUNT_LIMIT = 99;

/** Inclusive bounds. The minimum is always set and defaults to 0. The maximum may be open. */
export type ElementCountRange = {
  min: number;
  max: number | null;
};

/** Moves one edge by one. The minimum stops at 0. An empty maximum starts at the minimum. */
export function stepCountRange(
  range: ElementCountRange,
  edge: 'min' | 'max',
  by: number,
): ElementCountRange {
  if (by !== 1 && by !== -1) return range;
  if (edge === 'min') {
    const next = range.min + by;
    if (next < 0 || next > COUNT_LIMIT) return range;
    if (range.max != null && next > range.max) return range;
    return { min: next, max: range.max };
  }
  if (range.max == null) {
    if (by < 0) return range;
    return { min: range.min, max: range.min };
  }
  const next = range.max + by;
  if (next > COUNT_LIMIT || next < range.min) return range;
  return { min: range.min, max: next };
}

/** Sets one edge. Values outside 0–99 are ignored. A value past the other edge clamps to it. */
export function setCountRangeBound(
  range: ElementCountRange,
  edge: 'min' | 'max',
  value: number | null,
): ElementCountRange {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > COUNT_LIMIT)) return range;
  if (edge === 'min') {
    const next = value ?? 0;
    const min = range.max != null && next > range.max ? range.max : next;
    return { min, max: range.max };
  }
  if (value != null && value < range.min) return { min: range.min, max: range.min };
  return { min: range.min, max: value };
}

export function elementTranslationCount(element: StoredElement): number {
  return element.equivalents.length;
}

export function elementDefinitionCount(element: StoredElement): number {
  return element.definitions.length;
}

/** Keep an element in one of the chosen modes. An empty list keeps every element. */
export function elementMatchesMode(element: StoredElement, modes: readonly ElementMode[]): boolean {
  if (modes.length === 0) return true;
  return element.mode !== null && modes.includes(element.mode);
}

/** Keep an element at one of the chosen comfort rates. An empty list keeps every element. */
export function elementMatchesComfort(element: StoredElement, comforts: readonly number[]): boolean {
  return comforts.length === 0 || comforts.includes(element.comfort);
}

/** `definitionMeta`, `exampleMeta`, and `formMeta` query values. Empty means no constraint. */
export function parseMetadataFilter(raw: string | null): ElementMetadataVariability {
  if (!raw) return {};
  try {
    return normalizeMetadataVariability(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Serializes a metadata selection. Empty selections are omitted from the query. */
export function formatMetadataFilter(filter: ElementMetadataVariability): string | null {
  const normalized = normalizeMetadataVariability(filter);
  return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
}

/**
 * Keep an element that has one of the selected values for every selected key.
 * Keys in different places all have to match. An empty selection keeps every element.
 */
export function elementMatchesMetadata(
  element: StoredElement,
  definitions: ElementMetadataVariability,
  examples: ElementMetadataVariability,
  forms: ElementMetadataVariability,
): boolean {
  return (
    variabilityMatches(element.definitionMetadata, definitions) &&
    variabilityMatches(element.exampleMetadata, examples) &&
    variabilityMatches(element.formMetadata, forms)
  );
}

/** Selected keys, across one metadata place. */
export function metadataFilterSize(filter: ElementMetadataVariability): number {
  return Object.values(filter).filter((values) => values.length > 0).length;
}

function variabilityMatches(
  index: ElementMetadataVariability | undefined,
  selected: ElementMetadataVariability,
): boolean {
  for (const [key, values] of Object.entries(selected)) {
    if (!values.length) continue;
    const have = index?.[key];
    if (!have || !values.some((value) => have.includes(value))) return false;
  }
  return true;
}

/** Keep an element whose translation and definition counts fall inside each range. */
export function elementMatchesCountRanges(
  element: StoredElement,
  translations: ElementCountRange,
  definitions: ElementCountRange,
): boolean {
  return (
    countInRange(elementTranslationCount(element), translations) &&
    countInRange(elementDefinitionCount(element), definitions)
  );
}

/** Gems earned in the element's current game. An element with no mode has none. */
function elementModeGems(element: StoredElement): number {
  const game =
    element.mode === 1
      ? 'translation'
      : element.mode === 2
        ? 'example'
        : element.mode === 3
          ? 'definition'
          : null;
  if (!game) return 0;
  let gems = 0;
  for (const definition of element.definitions) {
    for (const entry of definition.log) {
      if (entry.game === game) gems += entry.gems;
    }
  }
  return gems;
}

function countInRange(count: number, range: ElementCountRange): boolean {
  if (count < range.min) return false;
  if (range.max != null && count > range.max) return false;
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
  if (sort === 'clicks-desc' || sort === 'clicks-asc') {
    const diff = left.clicks - right.clicks;
    return (sort === 'clicks-desc' ? -diff : diff) || title;
  }
  if (sort === 'gems-desc' || sort === 'gems-asc') {
    const diff = elementModeGems(left) - elementModeGems(right);
    return (sort === 'gems-desc' ? -diff : diff) || title;
  }
  const count = sort === 'definitions-desc' ? elementDefinitionCount : elementTranslationCount;
  return count(right) - count(left) || title;
}
