import {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  metadataIndexesEmpty,
  normalizeMetadataVariability,
  sameMetadataIndexes,
  type ElementMetadataIndexes,
} from './metadata-variability';

const STORAGE_KEY = 'lingogem.metadata-catalog.v1';

/** Distinct metadata keys and values for definitions, examples, and forms. */
export type ElementCatalog = ElementMetadataIndexes;

export type CatalogInput = ElementMetadataIndexes;

export function emptyElementCatalog(): ElementCatalog {
  return emptyMetadataIndexes();
}

/** Keeps metadata lists in their saved order. */
export function normalizeElementCatalog(raw: unknown): ElementCatalog {
  if (!raw || typeof raw !== 'object') return emptyElementCatalog();
  const source = raw as Partial<CatalogInput>;
  return {
    definitionMetadata: normalizeMetadataVariability(source.definitionMetadata),
    exampleMetadata: normalizeMetadataVariability(source.exampleMetadata),
    formMetadata: normalizeMetadataVariability(source.formMetadata),
  };
}

/** Adds this element's metadata. Values already present stay in place. */
export function absorbSavedElement(
  catalog: ElementCatalog,
  element: ElementMetadataIndexes,
): ElementCatalog {
  return mergeMetadataIndexes(catalog, element);
}

/** Metadata that still appears on these elements. */
export function catalogFromElements(elements: readonly ElementMetadataIndexes[]): ElementCatalog {
  return elements.reduce(
    (catalog, element) => absorbSavedElement(catalog, element),
    emptyElementCatalog(),
  );
}

export async function readMetadataCatalog(): Promise<ElementCatalog> {
  return readStoredCatalog();
}

/** Keeps a catalog copied out of the retired IndexedDB store. An existing cache stays. */
export function rememberCatalogRecord(raw: unknown): void {
  try {
    if (readStoredRaw() != null) return;
    const catalog = normalizeElementCatalog(raw);
    if (metadataIndexesEmpty(catalog)) return;
    writeStoredCatalog(catalog);
  } catch {
    // The lists can be compiled again from the elements.
  }
}

/** Adds these keys and values to the app catalog. Values already present stay in place. */
export async function mergeMetadataCatalog(indexes: CatalogInput): Promise<ElementCatalog> {
  if (metadataIndexesEmpty(indexes)) return readMetadataCatalog();
  const current = await readMetadataCatalog();
  const next = mergeMetadataIndexes(current, indexes);
  if (sameMetadataIndexes(current, next)) return current;
  writeStoredCatalog(next);
  return next;
}

/** Replaces the app catalog with this union of values. */
export async function replaceMetadataCatalog(indexes: CatalogInput): Promise<ElementCatalog> {
  const next = normalizeElementCatalog(indexes);
  writeStoredCatalog(next);
  return next;
}

function readStoredCatalog(): ElementCatalog {
  return normalizeElementCatalog(readStoredRaw());
}

function readStoredRaw(): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredCatalog(catalog: ElementCatalog): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
}
