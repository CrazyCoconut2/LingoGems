import { CATALOG_ID, CATALOG_STORE, idbRequest, openDatabase } from '../database';
import {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  metadataIndexesEmpty,
  normalizeMetadataVariability,
  sameMetadataIndexes,
  type ElementMetadataIndexes,
} from './metadata-variability';

export async function readMetadataCatalog(): Promise<ElementMetadataIndexes> {
  if (typeof indexedDB === 'undefined') return emptyMetadataIndexes();
  const db = await openDatabase();
  return normalizeCatalog(
    await idbRequest(
      db.transaction(CATALOG_STORE, 'readonly').objectStore(CATALOG_STORE).get(CATALOG_ID),
    ),
  );
}

/** Adds these keys and values to the app catalog. Existing values stay. */
export async function mergeMetadataCatalog(
  indexes: ElementMetadataIndexes,
): Promise<ElementMetadataIndexes> {
  if (metadataIndexesEmpty(indexes) || typeof indexedDB === 'undefined') return readMetadataCatalog();
  const current = await readMetadataCatalog();
  const next = mergeMetadataIndexes(current, indexes);
  if (sameMetadataIndexes(current, next)) return current;
  await putCatalog(next);
  return next;
}

/** Replaces the app catalog with this union of values. */
export async function replaceMetadataCatalog(
  indexes: ElementMetadataIndexes,
): Promise<ElementMetadataIndexes> {
  const next = normalizeCatalog(indexes);
  if (typeof indexedDB === 'undefined') return next;
  await putCatalog(next);
  return next;
}

function normalizeCatalog(raw: unknown): ElementMetadataIndexes {
  if (!raw || typeof raw !== 'object') return emptyMetadataIndexes();
  const source = raw as Partial<ElementMetadataIndexes>;
  return {
    definitionMetadata: normalizeMetadataVariability(source.definitionMetadata),
    exampleMetadata: normalizeMetadataVariability(source.exampleMetadata),
    formMetadata: normalizeMetadataVariability(source.formMetadata),
  };
}

async function putCatalog(indexes: ElementMetadataIndexes): Promise<void> {
  const db = await openDatabase();
  await idbRequest(
    db.transaction(CATALOG_STORE, 'readwrite').objectStore(CATALOG_STORE).put({
      id: CATALOG_ID,
      ...indexes,
    }),
  );
}
