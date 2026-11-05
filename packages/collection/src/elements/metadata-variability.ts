type ElementMetadata = Record<string, string>;

/** Distinct metadata values for one place, such as definitions or forms. */
export type ElementMetadataVariability = Record<string, string[]>;

/** Distinct values for definitions, examples, and forms. */
export type ElementMetadataIndexes = {
  definitionMetadata: ElementMetadataVariability;
  exampleMetadata: ElementMetadataVariability;
  formMetadata: ElementMetadataVariability;
};

type MetadataSource = {
  metadata?: ElementMetadata | null;
  examples?: readonly MetadataSource[] | null;
  forms?: readonly MetadataSource[] | null;
};

export function emptyMetadataIndexes(): ElementMetadataIndexes {
  return {
    definitionMetadata: {},
    exampleMetadata: {},
    formMetadata: {},
  };
}

/** Every distinct key and value on definitions, their examples, and their forms. */
export function collectMetadataIndexes(
  definitions: readonly MetadataSource[],
): ElementMetadataIndexes {
  const definitionMetadata: ElementMetadata[] = [];
  const exampleMetadata: ElementMetadata[] = [];
  const formMetadata: ElementMetadata[] = [];
  for (const definition of definitions) {
    if (definition.metadata) definitionMetadata.push(definition.metadata);
    for (const example of definition.examples ?? []) {
      if (example?.metadata) exampleMetadata.push(example.metadata);
    }
    for (const form of definition.forms ?? []) {
      if (form?.metadata) formMetadata.push(form.metadata);
    }
  }
  return {
    definitionMetadata: variabilityFrom(definitionMetadata),
    exampleMetadata: variabilityFrom(exampleMetadata),
    formMetadata: variabilityFrom(formMetadata),
  };
}

export function metadataIndexesEmpty(indexes: ElementMetadataIndexes): boolean {
  return (
    Object.keys(indexes.definitionMetadata).length === 0 &&
    Object.keys(indexes.exampleMetadata).length === 0 &&
    Object.keys(indexes.formMetadata).length === 0
  );
}

/** Adds keys and values from `extra`. Values already present stay. */
export function mergeMetadataVariability(
  base: ElementMetadataVariability,
  extra: ElementMetadataVariability,
): ElementMetadataVariability {
  const sets = new Map<string, Set<string>>();
  addVariability(sets, base);
  addVariability(sets, extra);
  return variabilityFromSets(sets);
}

export function mergeMetadataIndexes(
  base: ElementMetadataIndexes,
  extra: ElementMetadataIndexes,
): ElementMetadataIndexes {
  return {
    definitionMetadata: mergeMetadataVariability(base.definitionMetadata, extra.definitionMetadata),
    exampleMetadata: mergeMetadataVariability(base.exampleMetadata, extra.exampleMetadata),
    formMetadata: mergeMetadataVariability(base.formMetadata, extra.formMetadata),
  };
}

export function sameMetadataIndexes(
  left: ElementMetadataIndexes,
  right: ElementMetadataIndexes,
): boolean {
  return (
    sameVariability(left.definitionMetadata, right.definitionMetadata) &&
    sameVariability(left.exampleMetadata, right.exampleMetadata) &&
    sameVariability(left.formMetadata, right.formMetadata)
  );
}

/** Keeps non-empty string keys and values. Lists are unique and sorted. */
export function normalizeMetadataVariability(value: unknown): ElementMetadataVariability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sets = new Map<string, Set<string>>();
  for (const [rawKey, rawValues] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key || reservedKey(key)) continue;
    const values = sets.get(key) ?? new Set<string>();
    for (const rawValue of variabilityValues(rawValues)) {
      const text = rawValue.trim();
      if (text) values.add(text);
    }
    if (values.size) sets.set(key, values);
  }
  return variabilityFromSets(sets);
}

function variabilityFrom(records: readonly ElementMetadata[]): ElementMetadataVariability {
  const sets = new Map<string, Set<string>>();
  for (const record of records) addVariability(sets, record);
  return variabilityFromSets(sets);
}

function addVariability(
  sets: Map<string, Set<string>>,
  source: ElementMetadataVariability | ElementMetadata | null | undefined,
): void {
  if (!source) return;
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = rawKey.trim();
    if (!key || reservedKey(key)) continue;
    const values = sets.get(key) ?? new Set<string>();
    for (const text of variabilityValues(rawValue)) {
      const trimmed = text.trim();
      if (trimmed) values.add(trimmed);
    }
    if (values.size) sets.set(key, values);
  }
}

function variabilityValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function variabilityFromSets(sets: Map<string, Set<string>>): ElementMetadataVariability {
  const result: ElementMetadataVariability = {};
  for (const key of [...sets.keys()].sort((left, right) => left.localeCompare(right))) {
    const values = sets.get(key);
    if (!values?.size) continue;
    result[key] = [...values].sort((left, right) => left.localeCompare(right));
  }
  return result;
}

function sameVariability(
  left: ElementMetadataVariability,
  right: ElementMetadataVariability,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const values = left[key];
    const other = right[key];
    if (!other || values.length !== other.length) return false;
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] !== other[index]) return false;
    }
  }
  return true;
}

function reservedKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
