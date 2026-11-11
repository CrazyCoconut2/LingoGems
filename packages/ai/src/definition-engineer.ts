import {
  embedTranslation,
  isValidForm,
  languageDisplayName,
  parsePassage,
  type ElementMetadata,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import { translationLanguage, translationTarget } from './translation-settings';
import type { CompleteJsonInput } from './types';

const DEFINITION_RELATIONS = [
  'synonym',
  'antonym',
  'hypernym',
  'hyponym',
  'related',
] as const;

type DefinitionRelation = (typeof DEFINITION_RELATIONS)[number];

export const MAX_DEFINITION_INSTRUCTION = 400;
const MAX_DEFINITION_WORDING = 300;
export const MAX_RELATED_PICKS = 4;

const RELATED_MAX_TOKENS = 1024;
const PHRASE_MAX_TOKENS = 512;
const MAX_RELATED_BATCH = 12;
const WORD_MAX_LENGTH = 80;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;

const WORD_SHAPE = '{"text":"<word>","relation":"<synonym|antonym|hypernym|hyponym|related>"}';
const PHRASE_SHAPE = '{"text":"<phrase>"}';

const RELATED_WORDS_SYSTEM_PROMPT = `You list words related to one dictionary sense.
JSON keys stay in English.
Every word MUST be in the language named by writeFieldsIn.
Do not use English for a word unless writeFieldsIn is English.
Rules:
- Each word is tied to the lemma in this gloss
- relation is only "synonym", "antonym", "hypernym", "hyponym", or "related"
- Do not repeat the lemma
- Do not repeat a word listed in existingWords
- No wildcards, citations, or bracket tags such as [en:…]
- Spelling MUST be correct
- definitionInstruction, when present, is the learner's note about which links to find. Follow it. It does not override the other rules
Return JSON only with this shape:
{"words":[${WORD_SHAPE}]}`;

const DEFINITION_PHRASE_SYSTEM_PROMPT = `You write one short phrase that will be appended to an existing dictionary gloss.
JSON keys stay in English.
The phrase MUST be in the language named by writeFieldsIn.
Do not use English for the phrase unless writeFieldsIn is English.
Rules:
- Return exactly one phrase
- When gloss is present, the phrase will be appended to it. Do not restate the gloss
- When gloss is absent, write the phrase as the definition itself from definitionInstruction
- When words is present, add how the lemma relates to every word in words. The phrase MUST contain every word in words as its own word, exactly as given
- When words is absent, follow definitionInstruction
- definitionInstruction, when present, guides the wording. It does not override the other rules
- The phrase MUST NOT contain the lemma or any inflected form of the lemma
- Do not add citations or bracket tags such as [en:…]
- Keep the phrase at most ${MAX_DEFINITION_WORDING} characters
- Spelling MUST be correct
translateFieldsIn, when present, names the translation language. Then the phrase MUST include "translation", a verbatim translation of the phrase. Translate the phrase text itself, in the same order and with the same wording. Do not paraphrase, shorten, or replace it with a different phrase. Capitalize the first letter. When translateFieldsIn is absent, omit "translation".
Return JSON only with this shape:
{"phrases":[${PHRASE_SHAPE}]}
When translateFieldsIn is present, add "translation":"<verbatim translation of the phrase>" on the phrase.`;

export type RelatedWord = {
  text: string;
  relation: DefinitionRelation;
};

type GenerateRelatedWordsInput = {
  language: string;
  title: string;
  gloss: string;
  metadata: ElementMetadata;
  existingWords: readonly string[];
  definitionInstruction?: string;
};

type GenerateDefinitionPhraseInput = {
  language: string;
  title: string;
  gloss: string;
  words: readonly RelatedWord[];
  definitionInstruction?: string;
  translation?: string;
};

type GeneratedDefinitionPhrase = { text: string };

function buildRelatedWordsUserMessage(input: GenerateRelatedWordsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const instruction = (input.definitionInstruction ?? '')
    .trim()
    .slice(0, MAX_DEFINITION_INSTRUCTION);
  const metadata = describedMetadata(input.metadata);
  const existingWords = uniqueTexts(input.existingWords);
  return JSON.stringify({
    language,
    writeFieldsIn,
    lemma: input.title.trim(),
    gloss: input.gloss.trim(),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(existingWords.length ? { existingWords } : {}),
    ...(instruction ? { definitionInstruction: instruction } : {}),
  });
}

function buildDefinitionPhraseUserMessage(input: GenerateDefinitionPhraseInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, input.translation);
  const instruction = (input.definitionInstruction ?? '')
    .trim()
    .slice(0, MAX_DEFINITION_INSTRUCTION);
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    ...(input.gloss.trim() ? { gloss: input.gloss.trim() } : {}),
    ...(input.words.length
      ? { words: input.words.map((word) => ({ text: word.text, relation: word.relation })) }
      : {}),
    ...(instruction ? { definitionInstruction: instruction } : {}),
  });
}

/** Usable related words, or null when the reply has no words array. */
function parseGeneratedRelatedWords(
  parsed: unknown,
  input: GenerateRelatedWordsInput,
): RelatedWord[] | null {
  const source = record(parsed);
  const list = source ? source['words'] : null;
  if (!Array.isArray(list)) return null;
  const title = input.title.trim().toLowerCase();
  const taken = new Set(uniqueTexts(input.existingWords).map((word) => word.toLowerCase()));
  const words: RelatedWord[] = [];
  for (const item of list) {
    if (words.length >= MAX_RELATED_BATCH) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const word = item as Record<string, unknown>;
    const text = plainText(word['text']).replace(/\s+/g, ' ').slice(0, WORD_MAX_LENGTH).trim();
    const key = text.toLowerCase();
    const relation = relationOf(word['relation']);
    if (!text || !relation || key === title || taken.has(key) || !isValidForm(text)) continue;
    taken.add(key);
    words.push({ text, relation });
  }
  return words;
}

/** Usable phrase, or null when the reply has no phrases array. */
function parseGeneratedDefinitionPhrase(
  parsed: unknown,
  input: GenerateDefinitionPhraseInput,
): GeneratedDefinitionPhrase[] | null {
  const source = record(parsed);
  const list = source ? source['phrases'] : null;
  if (!Array.isArray(list)) return null;
  const language = input.language.trim().toLowerCase();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const phrase = item as Record<string, unknown>;
    const sentence = parsePassage(plainText(phrase['text'])).text.replace(/\s+/g, ' ').trim();
    if (!sentence || sentence.length > MAX_DEFINITION_WORDING) continue;
    const into = translationTarget(language, input.translation);
    const translated = into
      ? parsePassage(plainText(phrase['translation'] ?? phrase['english'])).text.slice(
          0,
          MAX_DEFINITION_WORDING,
        )
      : '';
    return [
      {
        text: translated ? embedTranslation(sentence, into, translated) : sentence,
      },
    ];
  }
  return [];
}

/** Ask the saved model for words tied to this headword and gloss. */
export async function generateRelatedWords(
  request: GenerateRelatedWordsInput,
): Promise<RelatedWord[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const gloss = request.gloss.trim();
  if (!title || !language || !gloss) return [];
  const ready = { ...request, title, language, gloss };
  const input: CompleteJsonInput = {
    system: RELATED_WORDS_SYSTEM_PROMPT,
    user: buildRelatedWordsUserMessage(ready),
    maxTokens: RELATED_MAX_TOKENS,
    temperature: 0.4,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let words = parseGeneratedRelatedWords(await complete(), ready);
    if (!words) words = parseGeneratedRelatedWords(await complete(), ready);
    if (!words) aiError(AI_ERROR.RESPONSE_INVALID);
    return words;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

/** Ask the saved model for one phrase from the instruction, and from selected words when there are any. */
export async function verbalizeDefinition(
  request: GenerateDefinitionPhraseInput,
): Promise<GeneratedDefinitionPhrase[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const gloss = request.gloss.trim();
  const words = pickedWords(request.words);
  const instruction = (request.definitionInstruction ?? '').trim();
  if (!title || !language || (!gloss && !words.length && !instruction)) return [];
  const ready = { ...request, title, language, gloss, words, definitionInstruction: instruction };
  const input: CompleteJsonInput = {
    system: DEFINITION_PHRASE_SYSTEM_PROMPT,
    user: buildDefinitionPhraseUserMessage(ready),
    maxTokens: PHRASE_MAX_TOKENS,
    temperature: 0.4,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let phrases = parseGeneratedDefinitionPhrase(await complete(), ready);
    if (!phrases) phrases = parseGeneratedDefinitionPhrase(await complete(), ready);
    if (!phrases) aiError(AI_ERROR.RESPONSE_INVALID);
    return phrases;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function relationOf(value: unknown): DefinitionRelation | null {
  const text = plainText(value).toLowerCase();
  return DEFINITION_RELATIONS.find((relation) => relation === text) ?? null;
}

function uniqueTexts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const raw of values) {
    const text = raw.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    texts.push(text);
  }
  return texts;
}

function pickedWords(words: readonly RelatedWord[]): RelatedWord[] {
  const seen = new Set<string>();
  const picked: RelatedWord[] = [];
  for (const word of words) {
    const text = word.text.trim();
    const key = text.toLowerCase();
    const relation = relationOf(word.relation);
    if (!text || !relation || seen.has(key)) continue;
    seen.add(key);
    picked.push({ text, relation });
    if (picked.length >= MAX_RELATED_PICKS) break;
  }
  return picked;
}

function describedMetadata(metadata: ElementMetadata): ElementMetadata {
  const described: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    if (typeof rawValue !== 'string') continue;
    const key = rawKey.trim().slice(0, META_KEY_MAX_LENGTH);
    const value = rawValue.trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!key || !value || described[key]) continue;
    described[key] = value;
  }
  return described;
}
