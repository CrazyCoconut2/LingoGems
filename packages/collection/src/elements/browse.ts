import {
  DEFINITION_COVERAGE_MAX,
  elementGemCounts,
  type DefinitionGameLog,
  type StoredElement,
} from './element-store';
import {
  normalizeMetadataVariability,
  type ElementMetadataVariability,
} from './metadata-variability';

const ELEMENT_SORTS = [
  'title-asc',
  'title-desc',
  'created-desc',
  'created-asc',
  'definitions-desc',
  'translations-desc',
  'gems-desc',
  'gems-asc',
  'none',
] as const;

export type ElementSort = (typeof ELEMENT_SORTS)[number];

export const DEFAULT_ELEMENT_SORT: ElementSort = 'created-desc';

function elementTranslationCount(element: StoredElement): number {
  return element.equivalents.length;
}

function elementDefinitionCount(element: StoredElement): number {
  return element.definitions.length;
}

/** Keep an element in one of the chosen colors. An empty list keeps every element. */
export function elementMatchesColor(
  element: StoredElement,
  colors: readonly string[],
): boolean {
  return colors.length === 0 || (element.color != null && colors.includes(element.color));
}

/** Coverage out of 10 for a definition recall. Other games keep their stored score. */
export function definitionCoverage(entry: DefinitionGameLog): number {
  if (entry.game !== 'definition') return entry.score;
  const coverage = entry.extra ? entry.score - 1 : entry.score;
  return Math.min(DEFINITION_COVERAGE_MAX, Math.max(0, coverage));
}

/** Mean definition-recall coverage, or null when this element has not been scored. */
export function definitionScoreAverage(element: StoredElement): number | null {
  let total = 0;
  let count = 0;
  for (const entry of element.log) {
    if (entry.event !== 'game' || entry.game !== 'definition' || !Number.isFinite(entry.score)) {
      continue;
    }
    total += definitionCoverage(entry);
    count += 1;
  }
  return count ? total / count : null;
}

/** Nearest whole score from 1 through 10. A scored 0 is 1. */
export function definitionScoreStep(average: number): number {
  if (!Number.isFinite(average)) return 1;
  return Math.min(10, Math.max(1, Math.round(average)));
}

/** Color score for this element, or null when it has not been scored. */
export function elementScoreStep(element: StoredElement): number | null {
  const average = definitionScoreAverage(element);
  return average == null ? null : definitionScoreStep(average);
}

/** Keep an element on one of the chosen scores. An empty list with unscored off keeps every element. */
export function elementMatchesScore(
  element: StoredElement,
  steps: readonly number[],
  unscored = false,
): boolean {
  if (!steps.length && !unscored) return true;
  const step = elementScoreStep(element);
  if (step == null) return unscored;
  return steps.includes(step);
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

function elementGems(element: StoredElement): number {
  const counts = elementGemCounts(element);
  return counts.translation + counts.example + counts.definition;
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
  if (sort === 'gems-desc' || sort === 'gems-asc') {
    const diff = elementGems(left) - elementGems(right);
    return (sort === 'gems-desc' ? -diff : diff) || title;
  }
  const count = sort === 'definitions-desc' ? elementDefinitionCount : elementTranslationCount;
  return count(right) - count(left) || title;
}
