import { requestPersistentStorage } from './persistent-storage';

const DB_NAME = 'lingogem';
const DB_VERSION = 5;

export const ELEMENTS_STORE = 'elements';
export const CATALOG_STORE = 'catalog';
export const TRANSLATIONS_STORE = 'translations';
export const CATALOG_ID = 'app';

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
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
        db.createObjectStore(TRANSLATIONS_STORE, { keyPath: ['source', 'target', 'phrase'] });
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

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
