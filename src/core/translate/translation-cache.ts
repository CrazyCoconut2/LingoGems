import { translatePhrase } from './translate';

const STORAGE_KEY = 'lingogem.phrase-translations';

export type PhraseTranslation = {
  text: string;
  dates: string[];
};

type PhraseBucket = Record<string, PhraseTranslation>;
type TranslationStore = Record<string, PhraseBucket>;

const pending = new Map<string, Promise<string>>();

function pairKey(sourceLang: string, targetLang: string): string {
  const source = sourceLang.trim().toLowerCase();
  const target = targetLang.trim().toLowerCase();
  if (!source || !target || source === target) return '';
  return `${source}>${target}`;
}

function phraseKey(phrase: string): string {
  return phrase.trim();
}

function requestKey(sourceLang: string, targetLang: string, phrase: string): string {
  return `${pairKey(sourceLang, targetLang)}\0${phraseKey(phrase)}`;
}

function readStore(): TranslationStore {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '');
    return storeOf(parsed);
  } catch {
    return {};
  }
}

function writeStore(store: TranslationStore): void {
  if (typeof localStorage === 'undefined') return;
  if (!Object.keys(store).length) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function storeOf(value: unknown): TranslationStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const store: TranslationStore = {};
  for (const [pair, bucket] of Object.entries(value)) {
    if (!pair.includes('>')) continue;
    const phrases = bucketOf(bucket);
    if (Object.keys(phrases).length) store[pair] = phrases;
  }
  return store;
}

function bucketOf(value: unknown): PhraseBucket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const bucket: PhraseBucket = {};
  for (const [phrase, entry] of Object.entries(value)) {
    const text = phrase.trim();
    const record = entryOf(entry);
    if (text && record) bucket[text] = record;
  }
  return bucket;
}

function entryOf(value: unknown): PhraseTranslation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = String((value as { text?: unknown }).text ?? '').trim();
  if (!text) return null;
  return { text, dates: datesOf((value as { dates?: unknown }).dates) };
}

function datesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && isoInstant(item));
}

function isoInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** The stored translation for this phrase, or null when this language pair has none. */
export function readPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
): PhraseTranslation | null {
  const pair = pairKey(sourceLang, targetLang);
  const key = phraseKey(phrase);
  if (!pair || !key) return null;
  return readStore()[pair]?.[key] ?? null;
}

/** Remember one request. A phrase that already has text keeps that text and gains a UTC instant. */
export function recordPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text: string,
): string {
  const pair = pairKey(sourceLang, targetLang);
  const key = phraseKey(phrase);
  const body = text.trim();
  if (!pair || !key || !body) throw new Error('translate_failed');
  const store = readStore();
  const bucket = { ...(store[pair] ?? {}) };
  const current = bucket[key];
  const stored = current?.text || body;
  bucket[key] = { text: stored, dates: [...(current?.dates ?? []), new Date().toISOString()] };
  store[pair] = bucket;
  writeStore(store);
  return stored;
}

/**
 * The translation for one click.
 * A cached phrase gains a UTC instant and is not queried.
 * A passage that still has an embedded translation is stored the same way.
 * Otherwise the model is asked, and a failed query writes nothing.
 */
export async function requestPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  seeded = '',
): Promise<string> {
  const key = requestKey(sourceLang, targetLang, phrase);
  if (!key || key.startsWith('\0') || key.endsWith('\0')) throw new Error('translate_failed');
  const cached = readPhraseTranslation(sourceLang, targetLang, phrase);
  if (cached?.text) return recordPhraseTranslation(sourceLang, targetLang, phrase, cached.text);

  const running = pending.get(key);
  if (running) {
    const text = await running;
    return recordPhraseTranslation(sourceLang, targetLang, phrase, text);
  }

  const job = resolvePhrase(sourceLang, targetLang, phrase, seeded);
  pending.set(key, job);
  try {
    const text = await job;
    return recordPhraseTranslation(sourceLang, targetLang, phrase, text);
  } finally {
    if (pending.get(key) === job) pending.delete(key);
  }
}

async function resolvePhrase(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  seeded: string,
): Promise<string> {
  const seed = seeded.trim();
  if (seed) return seed;
  return translatePhrase(phrase, sourceLang, targetLang);
}
