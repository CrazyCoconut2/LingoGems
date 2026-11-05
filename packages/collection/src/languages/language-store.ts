import { idbRequest, LANGUAGES_STORE, openDatabase } from '../database';
import {
  emptyMetadataIndexes,
  mergeMetadataVariability,
  metadataIndexesEmpty,
  normalizeMetadataVariability,
  sameMetadataIndexes,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
} from '../elements/metadata-variability';
import {
  emptyGemMeanings,
  normalizeGemMeanings,
  type GemMeanings,
} from '../elements/element-store';
import { isLearnableLanguage, type LearnableLanguage } from './catalog';

export type StoredLanguage = {
  code: LearnableLanguage;
  createdAt: number;
  /** Every definition metadata value seen in this language. */
  definitionMetadata: ElementMetadataVariability;
  /** Every example metadata value seen in this language. */
  exampleMetadata: ElementMetadataVariability;
  /** Every form metadata value seen in this language. */
  formMetadata: ElementMetadataVariability;
  /** The gem named for each rune in this language. A blank gem uses that rune's default. */
  gemMeanings: GemMeanings;
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
    ...emptyMetadataIndexes(),
    gemMeanings: emptyGemMeanings(),
  };
  await putLanguage(created);
  return created;
}

export async function readLanguage(code: string): Promise<StoredLanguage | null> {
  return getLanguage(code.trim().toLowerCase());
}

/** Adds this element's keys and values to the language. Existing values stay. */
export async function mergeLanguageMetadata(
  code: string,
  indexes: ElementMetadataIndexes,
): Promise<void> {
  if (!isLearnableLanguage(code) || metadataIndexesEmpty(indexes)) return;
  const language = await getLanguage(code);
  if (!language) return;
  const next = withMetadata(language, {
    definitionMetadata: mergeMetadataVariability(
      language.definitionMetadata,
      indexes.definitionMetadata,
    ),
    exampleMetadata: mergeMetadataVariability(language.exampleMetadata, indexes.exampleMetadata),
    formMetadata: mergeMetadataVariability(language.formMetadata, indexes.formMetadata),
  });
  if (sameMetadataIndexes(language, next)) return;
  await putLanguage(next);
}

/** Replaces the language choice lists with the union of every element. */
export async function replaceLanguageMetadata(
  code: string,
  indexes: ElementMetadataIndexes,
): Promise<StoredLanguage | null> {
  const language = await getLanguage(code.trim().toLowerCase());
  if (!language) return null;
  const next = withMetadata(language, {
    definitionMetadata: normalizeMetadataVariability(indexes.definitionMetadata),
    exampleMetadata: normalizeMetadataVariability(indexes.exampleMetadata),
    formMetadata: normalizeMetadataVariability(indexes.formMetadata),
  });
  await putLanguage(next);
  return next;
}

export async function saveLanguage(language: StoredLanguage): Promise<void> {
  const normalized = normalizeLanguage(language);
  if (!normalized) return;
  await putLanguage(normalized);
}

/** Writes this language's gem names without touching its other fields. */
export async function saveLanguageGemMeanings(code: string, meanings: GemMeanings): Promise<void> {
  const language = await getLanguage(code.trim().toLowerCase());
  if (!language) return;
  const gemMeanings = normalizeGemMeanings(meanings);
  if (sameGemMeanings(language.gemMeanings, gemMeanings)) return;
  await putLanguage({ ...language, gemMeanings });
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
  const source = raw as Partial<StoredLanguage>;
  return {
    code,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
    definitionMetadata: normalizeMetadataVariability(source.definitionMetadata),
    exampleMetadata: normalizeMetadataVariability(source.exampleMetadata),
    formMetadata: normalizeMetadataVariability(source.formMetadata),
    gemMeanings: normalizeGemMeanings(source.gemMeanings),
  };
}

function sameGemMeanings(left: GemMeanings, right: GemMeanings): boolean {
  return (
    left['gem-1'] === right['gem-1'] &&
    left['gem-2'] === right['gem-2'] &&
    left['gem-3'] === right['gem-3'] &&
    left['gem-4'] === right['gem-4'] &&
    left['gem-5'] === right['gem-5']
  );
}

function withMetadata(language: StoredLanguage, indexes: ElementMetadataIndexes): StoredLanguage {
  return {
    ...language,
    definitionMetadata: indexes.definitionMetadata,
    exampleMetadata: indexes.exampleMetadata,
    formMetadata: indexes.formMetadata,
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
