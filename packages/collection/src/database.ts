import {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  normalizeMetadataVariability,
} from './elements/metadata-variability';
import { requestPersistentStorage } from './persistent-storage';

const DB_NAME = 'lingogem';
const DB_VERSION = 3;

const LANGUAGES_STORE = 'languages';
export const ELEMENTS_STORE = 'elements';
export const CATALOG_STORE = 'catalog';
export const CATALOG_ID = 'app';

let database: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  void requestPersistentStorage();
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(LANGUAGES_STORE)) {
        db.createObjectStore(LANGUAGES_STORE, { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains(ELEMENTS_STORE)) {
        const elements = db.createObjectStore(ELEMENTS_STORE, { keyPath: 'id' });
        elements.createIndex('language', 'language', { unique: false });
      } else if (tx) {
        const elements = tx.objectStore(ELEMENTS_STORE);
        if (!elements.indexNames.contains('language')) {
          elements.createIndex('language', 'language', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE, { keyPath: 'id' });
      }
      if (event.oldVersion < 3 && tx) seedCatalog(tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
  return database;
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Copies metadata lists off every language record into the single catalog. */
function seedCatalog(tx: IDBTransaction): void {
  const request = tx.objectStore(LANGUAGES_STORE).getAll();
  request.onsuccess = () => {
    const records = Array.isArray(request.result) ? request.result : [];
    let indexes = emptyMetadataIndexes();
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const source = record as {
        definitionMetadata?: unknown;
        exampleMetadata?: unknown;
        formMetadata?: unknown;
      };
      indexes = mergeMetadataIndexes(indexes, {
        definitionMetadata: normalizeMetadataVariability(source.definitionMetadata),
        exampleMetadata: normalizeMetadataVariability(source.exampleMetadata),
        formMetadata: normalizeMetadataVariability(source.formMetadata),
      });
    }
    tx.objectStore(CATALOG_STORE).put({ id: CATALOG_ID, ...indexes });
  };
}
