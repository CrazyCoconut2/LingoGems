import { idbRequest, LANGUAGES_STORE, openDatabase } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from './catalog';

export type StoredLanguage = {
  code: LearnableLanguage;
  createdAt: number;
};

export async function readLanguages(): Promise<StoredLanguage[]> {
  if (typeof indexedDB === 'undefined') return [];
  const records = await getAll();
  const languages = records
    .map(normalizeLanguage)
    .filter((language): language is StoredLanguage => language !== null)
    .sort((left, right) => left.createdAt - right.createdAt || left.code.localeCompare(right.code));
  const stale = records.filter(
    (record) => record && typeof record === 'object' && 'mode' in record,
  );
  if (stale.length) {
    await Promise.all(
      stale.map(async (record) => {
        const language = normalizeLanguage(record);
        if (language) await putLanguage(language);
      }),
    );
  }
  return languages;
}

export async function addLanguage(code: string): Promise<StoredLanguage> {
  const normalized = code.trim().toLowerCase();
  if (!isLearnableLanguage(normalized)) {
    throw new Error(`Unsupported language "${code}"`);
  }
  const existing = await getLanguage(normalized);
  if (existing) return existing;
  const created: StoredLanguage = {
    code: normalized,
    createdAt: Date.now(),
  };
  await putLanguage(created);
  return created;
}

export async function saveLanguage(language: StoredLanguage): Promise<void> {
  if (!isLearnableLanguage(language.code)) return;
  await putLanguage({
    code: language.code,
    createdAt: language.createdAt,
  });
}

async function getLanguage(code: string): Promise<StoredLanguage | null> {
  if (!isLearnableLanguage(code) || typeof indexedDB === 'undefined') return null;
  const db = await openDatabase();
  return normalizeLanguage(
    await idbRequest(
      db.transaction(LANGUAGES_STORE, 'readonly').objectStore(LANGUAGES_STORE).get(code),
    ),
  );
}

function normalizeLanguage(raw: unknown): StoredLanguage | null {
  if (!raw || typeof raw !== 'object') return null;
  const code = String((raw as { code?: unknown }).code ?? '')
    .trim()
    .toLowerCase();
  if (!isLearnableLanguage(code)) return null;
  const createdAtValue = (raw as { createdAt?: unknown }).createdAt;
  return {
    code,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
}

async function getAll(): Promise<unknown[]> {
  const db = await openDatabase();
  const result = await idbRequest(
    db.transaction(LANGUAGES_STORE, 'readonly').objectStore(LANGUAGES_STORE).getAll(),
  );
  return Array.isArray(result) ? result : [];
}

async function putLanguage(language: StoredLanguage): Promise<void> {
  const db = await openDatabase();
  await idbRequest(
    db.transaction(LANGUAGES_STORE, 'readwrite').objectStore(LANGUAGES_STORE).put(language),
  );
}
