import {
  notePhraseUnveil,
  readPhraseTranslation,
  recordPhraseTranslation,
  replacePhraseTranslation,
} from 'collection';
import { translateDefinitionPhrase, translatePhrase } from './translate';

export {
  notePhraseUnveil,
  readPhraseTranslation,
  recordPhraseTranslation,
  replacePhraseTranslation,
};
export type { PhraseTranslation } from 'collection';

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
