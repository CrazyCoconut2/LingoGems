import { rememberCatalogRecord } from './elements/metadata-catalog';
import { requestPersistentStorage } from './persistent-storage';

const DB_NAME = 'lingogem';
const DB_VERSION = 7;
const RETIRED_CATALOG_STORE = 'catalog';
const RETIRED_CATALOG_ID = 'app';

export const ELEMENTS_STORE = 'elements';
export const TRANSLATIONS_STORE = 'translations';
export const GRAMMAR_STORE = 'grammar';

let database: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  void requestPersistentStorage();
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (db.objectStoreNames.contains('languages')) db.deleteObjectStore('languages');
      if (!db.objectStoreNames.contains(ELEMENTS_STORE)) {
        const elements = db.createObjectStore(ELEMENTS_STORE, { keyPath: 'id' });
        elements.createIndex('language', 'language', { unique: false });
      } else if (tx) {
        const elements = tx.objectStore(ELEMENTS_STORE);
        if (!elements.indexNames.contains('language')) {
          elements.createIndex('language', 'language', { unique: false });
        }
      }
      if (db.objectStoreNames.contains(RETIRED_CATALOG_STORE) && tx) {
        retireCatalogStore(db, tx);
      }
      if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
        db.createObjectStore(TRANSLATIONS_STORE, { keyPath: ['source', 'target', 'phrase'] });
      }
      if (!db.objectStoreNames.contains(GRAMMAR_STORE)) {
        const grammar = db.createObjectStore(GRAMMAR_STORE, { keyPath: 'id' });
        grammar.createIndex('language', 'language', { unique: false });
      } else if (tx) {
        const grammar = tx.objectStore(GRAMMAR_STORE);
        if (!grammar.indexNames.contains('language')) {
          grammar.createIndex('language', 'language', { unique: false });
        }
      }
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

function retireCatalogStore(db: IDBDatabase, tx: IDBTransaction): void {
  const request = tx.objectStore(RETIRED_CATALOG_STORE).get(RETIRED_CATALOG_ID);
  const drop = () => {
    if (db.objectStoreNames.contains(RETIRED_CATALOG_STORE)) {
      db.deleteObjectStore(RETIRED_CATALOG_STORE);
    }
  };
  request.onsuccess = () => {
    rememberCatalogRecord(request.result);
    drop();
  };
  request.onerror = (event) => {
    event.preventDefault();
    drop();
  };
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
