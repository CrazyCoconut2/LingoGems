import { isLearnableLanguage, type LearnableLanguage } from './catalog';

export type LanguageMode = 'settler' | 'explorer';

export type StoredLanguage = {
  code: LearnableLanguage;
  mode: LanguageMode;
  createdAt: number;
};

const DB_NAME = 'lingogem';
const DB_VERSION = 1;
const STORE = 'languages';

let database: Promise<IDBDatabase> | null = null;

export async function readLanguages(): Promise<StoredLanguage[]> {
  if (typeof indexedDB === 'undefined') return [];
  const records = await getAll();
  return records
    .map(normalizeLanguage)
    .filter((language): language is StoredLanguage => language !== null)
    .sort((left, right) => left.createdAt - right.createdAt || left.code.localeCompare(right.code));
}

export async function addLanguage(code: string): Promise<StoredLanguage> {
  const normalized = code.trim().toLowerCase();
  if (!isLearnableLanguage(normalized)) {
    throw new Error(`Unsupported language "${code}"`);
  }
  const existing = (await readLanguages()).find((language) => language.code === normalized);
  if (existing) return existing;
  const created: StoredLanguage = {
    code: normalized,
    mode: 'settler',
    createdAt: Date.now(),
  };
  await putLanguage(created);
  return created;
}

export async function setLanguageMode(
  code: string,
  mode: LanguageMode,
): Promise<StoredLanguage | null> {
  const normalized = code.trim().toLowerCase();
  const existing = (await readLanguages()).find((language) => language.code === normalized);
  if (!existing) return null;
  const next: StoredLanguage = { ...existing, mode };
  await putLanguage(next);
  return next;
}

function normalizeLanguage(raw: unknown): StoredLanguage | null {
  if (!raw || typeof raw !== 'object') return null;
  const code = String((raw as { code?: unknown }).code ?? '')
    .trim()
    .toLowerCase();
  if (!isLearnableLanguage(code)) return null;
  const modeValue = String((raw as { mode?: unknown }).mode ?? '').trim();
  const createdAtValue = (raw as { createdAt?: unknown }).createdAt;
  return {
    code,
    mode: modeValue === 'explorer' ? 'explorer' : 'settler',
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'code' });
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

async function getAll(): Promise<unknown[]> {
  const db = await openDatabase();
  const result = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  return Array.isArray(result) ? result : [];
}

async function putLanguage(language: StoredLanguage): Promise<void> {
  const db = await openDatabase();
  await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(language));
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
