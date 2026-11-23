import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const TRANSLATE_SYSTEM_PROMPT = `You translate each input string into targetLang.
JSON keys stay in English.
texts is an array of strings. Return exactly one translation per item, same order and count. Do not merge, split, reorder, drop, or invent items. Do not add commentary, quotes, or extra markup.
When sourceLang is present, treat it as the source language; otherwise detect it.
Keep meaning literal and faithful. Preserve punctuation and line breaks inside each string.
Spelling in targetLang MUST be correct. No orthographic errors, no invented spellings.
JSON only: {"translations":["<text 0>","<text 1>",...]}`;

const TRANSLATE_MAX_TOKENS = 4096;

type GenerateTranslatePromptInput = {
  texts: string[];
  targetLang: string;
  sourceLang?: string | null;
};

function buildTranslateUserMessage(input: GenerateTranslatePromptInput): string {
  const targetLang = languageDisplayName(input.targetLang) || String(input.targetLang || '').trim();
  const sourceRaw = String(input.sourceLang || '').trim();
  const sourceLang = sourceRaw ? languageDisplayName(sourceRaw) || sourceRaw : '';
  return JSON.stringify({
    texts: input.texts.map((text) => String(text ?? '').trim()),
    targetLang,
    ...(sourceLang ? { sourceLang } : {}),
  });
}

/** Exact 1:1 translations, or null when the model dropped or added items. */
function parseGeneratedTranslations(parsed: unknown, expectedCount: number): string[] | null {
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) return [];
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['translations'] : null;
  if (!Array.isArray(list) || list.length !== expectedCount) return null;
  return list.map((item) => String(item ?? '').trim());
}

const EQUIVALENT_SYSTEM_PROMPT = `You give one translation of a headword for a single dictionary sense.
JSON keys stay in English.
Return the headword's equivalent in targetLang for this sense only: a word or short phrase a dictionary would list as the translation of the lemma.
Use the definition to choose the sense. Do not translate the definition sentence itself.
When translation is present, it is a gloss of that definition in the translation language. Use it to choose the sense.
Capitalize the first letter.
Spelling in targetLang MUST be correct.
JSON only: {"translation":"<equivalent>"}`;

const EQUIVALENT_MAX_TOKENS = 512;

type GenerateEquivalentInput = {
  lemma: string;
  sourceLang: string;
  definition: string;
  english?: string | null;
  targetLang?: string | null;
};

function buildEquivalentUserMessage(input: GenerateEquivalentInput): string {
  const sourceRaw = String(input.sourceLang || '').trim();
  const sourceLang = sourceRaw ? languageDisplayName(sourceRaw) || sourceRaw : '';
  const targetRaw = String(input.targetLang || '').trim();
  const targetLang = targetRaw ? languageDisplayName(targetRaw) || targetRaw : '';
  const english = String(input.english || '').trim();
  return JSON.stringify({
    lemma: String(input.lemma || '').trim(),
    ...(sourceLang ? { sourceLang } : {}),
    targetLang,
    definition: String(input.definition || '').trim(),
    ...(english ? { translation: english } : {}),
  });
}

/** One headword equivalent, or null when the reply has no translation string. */
function parseGeneratedEquivalent(parsed: unknown): string | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const text = capitalizePhrase(String(source['translation'] ?? ''));
  return text || null;
}

/** Ask for the headword's translation in this sense. The definition picks the sense. */
export async function generateEquivalent(request: GenerateEquivalentInput): Promise<string> {
  const lemma = String(request.lemma || '').trim();
  const definition = String(request.definition || '').trim();
  if (!lemma || !definition) return '';
  const input: CompleteJsonInput = {
    system: EQUIVALENT_SYSTEM_PROMPT,
    user: buildEquivalentUserMessage({ ...request, lemma, definition }),
    maxTokens: EQUIVALENT_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let equivalent = parseGeneratedEquivalent(await complete());
    if (!equivalent) equivalent = parseGeneratedEquivalent(await complete());
    if (!equivalent) aiError(AI_ERROR.RESPONSE_INVALID);
    return equivalent;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function capitalizePhrase(value: string): string {
  const text = value.replace(/]/g, '').trim();
  return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('en'));
}

const DEFINITION_TRANSLATION_SYSTEM_PROMPT = `You translate one dictionary definition and give the headword's equivalent for that sense.
JSON keys stay in English.
translation is the definition sentence in targetLang. Keep meaning literal and faithful. Preserve punctuation. Do not add commentary, quotes, or extra markup.
equivalent is the headword's equivalent in targetLang for this sense only: a word or short phrase a dictionary would list as the translation of the lemma.
Use the definition to choose the sense. Do not translate the definition sentence itself, and do not copy translation.
When sourceLang is present, treat it as the source language; otherwise detect it.
Capitalize the first letter of equivalent.
Spelling in targetLang MUST be correct. No orthographic errors, no invented spellings.
JSON only: {"translation":"<definition in targetLang>","equivalent":"<headword equivalent>"}`;

const DEFINITION_TRANSLATION_MAX_TOKENS = 1024;

export type DefinitionTranslation = {
  translation: string;
  equivalent: string;
};

type TranslateDefinitionInput = {
  lemma: string;
  definition: string;
  sourceLang: string;
  targetLang: string;
};

function buildDefinitionTranslationUserMessage(input: TranslateDefinitionInput): string {
  const sourceRaw = String(input.sourceLang || '').trim();
  const sourceLang = sourceRaw ? languageDisplayName(sourceRaw) || sourceRaw : '';
  const targetRaw = String(input.targetLang || '').trim();
  const targetLang = targetRaw ? languageDisplayName(targetRaw) || targetRaw : '';
  return JSON.stringify({
    lemma: String(input.lemma || '').trim(),
    ...(sourceLang ? { sourceLang } : {}),
    targetLang,
    definition: String(input.definition || '').trim(),
  });
}

/** Both strings, or null when the reply is not an object. Empty fields stay empty. */
function parseDefinitionTranslation(parsed: unknown): DefinitionTranslation | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  return {
    translation: String(source['translation'] ?? '').trim(),
    equivalent: capitalizePhrase(String(source['equivalent'] ?? '')),
  };
}

function mergeDefinitionTranslation(
  current: DefinitionTranslation | null,
  next: DefinitionTranslation | null,
): DefinitionTranslation | null {
  if (!current) return next;
  if (!next) return current;
  return {
    translation: current.translation || next.translation,
    equivalent: current.equivalent || next.equivalent,
  };
}

/** Translate the definition sentence and name the headword's equivalent for that sense. */
export async function translateDefinition(
  request: TranslateDefinitionInput,
): Promise<DefinitionTranslation> {
  const lemma = String(request.lemma || '').trim();
  const definition = String(request.definition || '').trim();
  if (!lemma || !definition) return { translation: '', equivalent: '' };
  const input: CompleteJsonInput = {
    system: DEFINITION_TRANSLATION_SYSTEM_PROMPT,
    user: buildDefinitionTranslationUserMessage({ ...request, lemma, definition }),
    maxTokens: DEFINITION_TRANSLATION_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let result = parseDefinitionTranslation(await complete());
    if (!result?.translation || !result.equivalent) {
      result = mergeDefinitionTranslation(result, parseDefinitionTranslation(await complete()));
    }
    if (!result?.translation) aiError(AI_ERROR.RESPONSE_INVALID);
    return result;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

/** Translate with the saved keys. Each request goes straight to that key's model provider. */
export async function translateTexts(request: GenerateTranslatePromptInput): Promise<string[]> {
  const texts = request.texts.map((item) => String(item ?? '').trim());
  if (texts.length === 0 || texts.some((item) => !item)) return [];
  const input: CompleteJsonInput = {
    system: TRANSLATE_SYSTEM_PROMPT,
    user: buildTranslateUserMessage({
      texts,
      targetLang: request.targetLang,
      sourceLang: request.sourceLang,
    }),
    maxTokens: TRANSLATE_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let parsed = await complete();
    let translations = parseGeneratedTranslations(parsed, texts.length);
    if (!translations) {
      parsed = await complete();
      translations = parseGeneratedTranslations(parsed, texts.length);
    }
    if (!translations) aiError(AI_ERROR.RESPONSE_INVALID);
    return translations;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
