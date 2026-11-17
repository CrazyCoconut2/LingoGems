import { CATALOG_ID, CATALOG_STORE, idbRequest, openDatabase } from '../database';
import { mergeElementColors, normalizeElementColors, orderElementColors } from './element-color';
import {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  metadataIndexesEmpty,
  normalizeMetadataVariability,
  sameMetadataIndexes,
  type ElementMetadataIndexes,
} from './metadata-variability';

/** Metadata lists plus the colors saved on elements, in display order. */
export type ElementCatalog = ElementMetadataIndexes & {
  colors: string[];
};

export type CatalogInput = ElementMetadataIndexes & {
  colors?: readonly unknown[];
};

export function emptyElementCatalog(): ElementCatalog {
  return { ...emptyMetadataIndexes(), colors: [] };
}

/** Keeps metadata lists and element colors, in their saved order. */
export function normalizeElementCatalog(raw: unknown): ElementCatalog {
  if (!raw || typeof raw !== 'object') return emptyElementCatalog();
  const source = raw as Partial<CatalogInput>;
  return {
    definitionMetadata: normalizeMetadataVariability(source.definitionMetadata),
    exampleMetadata: normalizeMetadataVariability(source.exampleMetadata),
    formMetadata: normalizeMetadataVariability(source.formMetadata),
    colors: normalizeElementColors(source.colors),
  };
}

/** Adds this element's metadata and color. Colors already present stay in place. */
export function absorbSavedElement(
  catalog: ElementCatalog,
  element: ElementMetadataIndexes & { color?: string | null },
): ElementCatalog {
  return {
    ...mergeMetadataIndexes(catalog, element),
    colors: mergeElementColors(catalog.colors, element.color ? [element.color] : []),
  };
}

/** Metadata and colors that still appear on these elements. `colorOrder` wins when set. */
export function catalogFromElements(
  elements: readonly (ElementMetadataIndexes & { color?: string | null })[],
  colorOrder?: readonly string[],
): ElementCatalog {
  const gathered = elements.reduce(
    (catalog, element) => absorbSavedElement(catalog, element),
    emptyElementCatalog(),
  );
  return {
    ...gathered,
    colors: orderElementColors(
      colorOrder ?? gathered.colors,
      elements.map((element) => element.color),
    ),
  };
}

export async function readMetadataCatalog(): Promise<ElementCatalog> {
  if (typeof indexedDB === 'undefined') return emptyElementCatalog();
  const db = await openDatabase();
  return normalizeElementCatalog(
    await idbRequest(
      db.transaction(CATALOG_STORE, 'readonly').objectStore(CATALOG_STORE).get(CATALOG_ID),
    ),
  );
}

/** Adds these keys, values, and colors to the app catalog. Existing colors stay in place. */
export async function mergeMetadataCatalog(indexes: CatalogInput): Promise<ElementCatalog> {
  const colors = normalizeElementColors(indexes.colors);
  if ((metadataIndexesEmpty(indexes) && colors.length === 0) || typeof indexedDB === 'undefined') {
    return readMetadataCatalog();
  }
  const current = await readMetadataCatalog();
  const next: ElementCatalog = {
    ...mergeMetadataIndexes(current, indexes),
    colors: mergeElementColors(current.colors, colors),
  };
  if (sameElementCatalog(current, next)) return current;
  await putCatalog(next);
  return next;
}

/** Replaces the app catalog with this union of values. */
export async function replaceMetadataCatalog(indexes: CatalogInput): Promise<ElementCatalog> {
  const next = normalizeElementCatalog(indexes);
  if (typeof indexedDB === 'undefined') return next;
  await putCatalog(next);
  return next;
}

function sameElementCatalog(left: ElementCatalog, right: ElementCatalog): boolean {
  return (
    sameMetadataIndexes(left, right) &&
    left.colors.length === right.colors.length &&
    left.colors.every((color, index) => color === right.colors[index])
  );
}

async function putCatalog(indexes: ElementCatalog): Promise<void> {
  const db = await openDatabase();
  await idbRequest(
    db
      .transaction(CATALOG_STORE, 'readwrite')
      .objectStore(CATALOG_STORE)
      .put({
        id: CATALOG_ID,
        ...indexes,
      }),
  );
}
