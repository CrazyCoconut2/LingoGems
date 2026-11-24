import { translateDefinitionPhrase, translatePhrase } from './translate';

const STORAGE_KEY = 'lingogem.phrase-translations';

export type PhraseTranslation = {
  text: string;
  dates: string[];
};

type PhraseBucket = Record<string, PhraseTranslation>;
type TranslationStore = Record<string, PhraseBucket>;

const EQUIVALENT_MAX = 200;

const pending = new Map<string, Promise<string>>();
const definitionPending = new Map<string, Promise<{ translation: string; equivalent: string }>>();

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

/**
 * Replace the stored translation for this phrase.
 * Unveil dates stay. Empty text removes the entry. This is not an unveil.
 */
export function replacePhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text: string,
): string {
  const pair = pairKey(sourceLang, targetLang);
  const key = phraseKey(phrase);
  if (!pair || !key) return '';
  const store = readStore();
  const bucket = { ...(store[pair] ?? {}) };
  const body = text.trim();
  if (!body) {
    delete bucket[key];
    if (Object.keys(bucket).length) store[pair] = bucket;
    else delete store[pair];
    writeStore(store);
    return '';
  }
  const current = bucket[key];
  bucket[key] = { text: body, dates: current?.dates ?? [] };
  store[pair] = bucket;
  writeStore(store);
  return body;
}

/** Store the translation text. An existing wording is kept, and unveil dates stay as they are. */
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
  bucket[key] = { text: current?.text || body, dates: current?.dates ?? [] };
  store[pair] = bucket;
  writeStore(store);
  return bucket[key].text;
}

/** One click that revealed a translation which was already stored. */
export function notePhraseUnveil(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text = '',
): void {
  const pair = pairKey(sourceLang, targetLang);
  const key = phraseKey(phrase);
  if (!pair || !key) return;
  const store = readStore();
  const bucket = { ...(store[pair] ?? {}) };
  const current = bucket[key];
  const stored = (current?.text || text).trim();
  if (!stored) return;
  bucket[key] = {
    text: stored,
    dates: [...(current?.dates ?? []), new Date().toISOString()],
  };
  store[pair] = bucket;
  writeStore(store);
}

/**
 * The translation for one request.
 * A stored phrase is returned as it is, with no new unveil.
 * A passage that still has an embedded translation is stored without an unveil.
 * Otherwise the model is asked. Seeing that new translation counts as an unveil.
 * A failed query writes nothing.
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
  if (cached?.text) return cached.text;

  const missing = !seeded.trim();
  const running = pending.get(key);
  if (running) {
    const text = await running;
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, text);
    if (missing) notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return stored;
  }

  const job = resolvePhrase(sourceLang, targetLang, phrase, seeded);
  pending.set(key, job);
  try {
    const text = await job;
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, text);
    if (missing) notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return stored;
  } finally {
    if (pending.get(key) === job) pending.delete(key);
  }
}

export type DefinitionTranslationResult = {
  translation: string;
  equivalent: string;
};

/**
 * The translation and headword equivalent for one definition.
 * A phrase that already has both is not queried.
 * An existing translation or equivalent is kept; the model fills only what is missing.
 * A new translation is stored the same way as a phrase translation. A failed query writes nothing.
 */
export async function requestDefinitionTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  lemma: string,
  seeded = '',
  equivalent = '',
): Promise<DefinitionTranslationResult> {
  const key = requestKey(sourceLang, targetLang, phrase);
  if (!key || key.startsWith('\0') || key.endsWith('\0')) throw new Error('translate_failed');
  const knownTranslation = (
    readPhraseTranslation(sourceLang, targetLang, phrase)?.text || seeded.trim()
  ).trim();
  const knownEquivalent = equivalent.trim().slice(0, EQUIVALENT_MAX);
  const missing = !knownTranslation;
  if (knownTranslation && knownEquivalent) {
    return {
      translation: recordPhraseTranslation(sourceLang, targetLang, phrase, knownTranslation),
      equivalent: knownEquivalent,
    };
  }

  const running = definitionPending.get(key);
  const job = running ?? translateDefinitionPhrase(lemma, phrase, sourceLang, targetLang);
  if (!running) definitionPending.set(key, job);
  try {
    const generated = await job;
    const translation = knownTranslation || generated.translation.trim();
    const nextEquivalent = (knownEquivalent || generated.equivalent.trim()).slice(
      0,
      EQUIVALENT_MAX,
    );
    if (!translation) throw new Error('translate_failed');
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, translation);
    if (missing) notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return {
      translation: stored,
      equivalent: nextEquivalent,
    };
  } catch (err) {
    if (!knownTranslation) throw err;
    return { translation: knownTranslation, equivalent: knownEquivalent };
  } finally {
    if (!running && definitionPending.get(key) === job) definitionPending.delete(key);
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
