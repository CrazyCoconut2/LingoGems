const DB_NAME = 'lingogem';
const DB_VERSION = 2;

export const LANGUAGES_STORE = 'languages';
export const ELEMENTS_STORE = 'elements';

let database: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LANGUAGES_STORE)) {
        db.createObjectStore(LANGUAGES_STORE, { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains(ELEMENTS_STORE)) {
        const elements = db.createObjectStore(ELEMENTS_STORE, { keyPath: 'id' });
        elements.createIndex('language', 'language', { unique: false });
      } else if (request.transaction) {
        const elements = request.transaction.objectStore(ELEMENTS_STORE);
        if (!elements.indexNames.contains('language')) {
          elements.createIndex('language', 'language', { unique: false });
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

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
