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
 * A stored wording is kept. Otherwise the model is asked.
 * Every request that returns a wording counts as an unveil.
 * A failed query writes nothing.
 */
export async function requestPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
): Promise<string> {
  const key = requestKey(sourceLang, targetLang, phrase);
  if (!key || key.startsWith('\0') || key.endsWith('\0')) throw new Error('translate_failed');
  const cached = readPhraseTranslation(sourceLang, targetLang, phrase);
  if (cached?.text) {
    notePhraseUnveil(sourceLang, targetLang, phrase, cached.text);
    return cached.text;
  }

  const running = pending.get(key);
  if (running) {
    const text = await running;
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, text);
    notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return stored;
  }

  const job = translatePhrase(phrase, sourceLang, targetLang);
  pending.set(key, job);
  try {
    const text = await job;
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, text);
    notePhraseUnveil(sourceLang, targetLang, phrase, stored);
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
 * A phrase that already has both is not sent to the model.
 * An existing translation or equivalent is kept; the model fills only what is missing.
 * Every request that returns a wording counts as an unveil, the same as a phrase request.
 * A failed query writes nothing.
 */
export async function requestDefinitionTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  lemma: string,
  equivalent = '',
): Promise<DefinitionTranslationResult> {
  const key = requestKey(sourceLang, targetLang, phrase);
  if (!key || key.startsWith('\0') || key.endsWith('\0')) throw new Error('translate_failed');
  const knownTranslation = (
    readPhraseTranslation(sourceLang, targetLang, phrase)?.text ?? ''
  ).trim();
  const knownEquivalent = equivalent.trim().slice(0, EQUIVALENT_MAX);
  if (knownTranslation && knownEquivalent) {
    const stored = recordPhraseTranslation(sourceLang, targetLang, phrase, knownTranslation);
    notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return { translation: stored, equivalent: knownEquivalent };
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
    notePhraseUnveil(sourceLang, targetLang, phrase, stored);
    return {
      translation: stored,
      equivalent: nextEquivalent,
    };
  } catch (err) {
    if (!knownTranslation) throw err;
    notePhraseUnveil(sourceLang, targetLang, phrase, knownTranslation);
    return { translation: knownTranslation, equivalent: knownEquivalent };
  } finally {
    if (!running && definitionPending.get(key) === job) definitionPending.delete(key);
  }
}
