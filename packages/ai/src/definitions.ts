import {
  embedTranslation,
  isValidForm,
  languageDisplayName,
  parsePassage,
  type ElementForm,
  type ElementMetadata,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const MAX_SENSES = 8;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;
const FORM_MAX_LENGTH = 100;
const DEFINITIONS_MAX_TOKENS = 8192;

const DEFINITION_METADATA_KEYS = ['part of speech', 'gender', 'transitivity', 'register'] as const;
const FORM_METADATA_KEYS = ['tense', 'person', 'number', 'mood'] as const;

const SENSE_SHAPE = `{"gloss":"<definition in writeFieldsIn>","metadata":{"part of speech":"<part of speech>"},"forms":[{"text":"<one surface form>","metadata":{"tense":"<tense>","person":"<person>","number":"<number>","mood":"<mood>"}},{"text":"<another surface form>","metadata":{"tense":"<tense>","person":"<person>","number":"<number>","mood":"<mood>"}}]}`;

export const DEFINITIONS_SYSTEM_PROMPT = `You write dictionary senses for one headword.
JSON keys stay in English.
Every gloss MUST be in the language named by writeFieldsIn.
Do not use English for a gloss unless writeFieldsIn is English.
Do not copy English labels into metadata; write those values in writeFieldsIn.
Rules:
- One sense per distinct meaning
- Do not repeat a meaning or a gloss already listed in existingGlosses
- Return at most ${MAX_SENSES} senses
- One short dictionary-style gloss per sense
- Do not include examples
- Do not add citations or bracket tags such as [en:…]
- Spelling MUST be correct in every gloss, English gloss, and form
- forms lists every distinct inflected surface form of that sense, not one example. For a verb, cover person, number, tense, and mood, plus the participle and gerund when they exist. For a noun or adjective, cover gender and number. Keep going until that paradigm is covered. Omit a form you cannot spell correctly
- The forms array in the shape shows the fields. It is not a limit of two forms. If the reply must be shorter, return fewer senses rather than one form per sense
- Do not include the headword. Do not repeat a form on the same sense
- No wildcards, regex, parentheses, or asterisks in a form
- metadata is key-value pairs that apply to that definition or form. Omit a pair when it does not apply
- Definition metadata keys are only "part of speech", "gender", "transitivity", and "register"
- Form metadata keys are only "tense", "person", "number", and "mood"
translateFieldsIn, when present, is English. Then each sense MUST include "english", a faithful English gloss of that sense. When translateFieldsIn is absent, omit "english".
Return JSON only with this shape:
{"senses":[${SENSE_SHAPE}]}
When translateFieldsIn is present, add "english":"<gloss in English>" on each sense.`;

export type GenerateDefinitionsInput = {
  language: string;
  title: string;
  existingGlosses: string[];
};

export type GeneratedDefinition = {
  text: string;
  metadata: ElementMetadata;
  forms: ElementForm[];
};

export function buildDefinitionsUserMessage(input: GenerateDefinitionsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = language && language !== 'en' ? 'English' : '';
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    existingGlosses: glossesOf(input.existingGlosses),
  });
}

/** Usable senses, or null when the reply has no senses array. */
export function parseGeneratedDefinitions(
  parsed: unknown,
  input: GenerateDefinitionsInput,
): GeneratedDefinition[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['senses'] : null;
  if (!Array.isArray(list)) return null;
  const language = input.language.trim().toLowerCase();
  const title = input.title.trim().toLowerCase();
  const taken = new Set(glossesOf(input.existingGlosses).map((gloss) => gloss.toLowerCase()));
  const definitions: GeneratedDefinition[] = [];
  for (const item of list) {
    if (definitions.length >= MAX_SENSES) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const sense = item as Record<string, unknown>;
    const gloss = glossText(sense['gloss'] ?? sense['glosses']);
    if (!gloss || taken.has(gloss.toLowerCase())) continue;
    taken.add(gloss.toLowerCase());
    const english =
      language === 'en' ? '' : plainText(sense['english']).slice(0, META_VALUE_MAX_LENGTH);
    definitions.push({
      text: english ? embedTranslation(gloss, 'en', english) : gloss,
      metadata: pickMetadata(sense['metadata'], DEFINITION_METADATA_KEYS),
      forms: parseForms(sense['forms'], title),
    });
  }
  return definitions;
}

/** Ask the saved model for senses this headword does not already have. */
export async function generateDefinitions(
  request: GenerateDefinitionsInput,
): Promise<GeneratedDefinition[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  if (!title || !language) return [];
  const input: CompleteJsonInput = {
    system: DEFINITIONS_SYSTEM_PROMPT,
    user: buildDefinitionsUserMessage({ ...request, title, language }),
    maxTokens: DEFINITIONS_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let senses = parseGeneratedDefinitions(await complete(), { ...request, title, language });
    if (!senses)
      senses = parseGeneratedDefinitions(await complete(), { ...request, title, language });
    if (!senses) aiError(AI_ERROR.RESPONSE_INVALID);
    return senses;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function glossesOf(values: readonly string[]): string[] {
  const glosses: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const gloss = parsePassage(String(value ?? '')).text.trim();
    const key = gloss.toLowerCase();
    if (!gloss || seen.has(key)) continue;
    seen.add(key);
    glosses.push(gloss);
  }
  return glosses;
}

function glossText(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return parsePassage(plainText(raw)).text.replace(/\s+/g, ' ').trim();
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickMetadata(value: unknown, keys: readonly string[]): ElementMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue;
    const canonical = keys.find((key) => key.toLowerCase() === rawKey.trim().toLowerCase());
    if (!canonical) continue;
    const text = rawValue.trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!text) continue;
    metadata[canonical.slice(0, META_KEY_MAX_LENGTH)] = text;
  }
  return metadata;
}

function parseForms(value: unknown, title: string): ElementForm[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const forms: ElementForm[] = [];
  for (const item of value) {
    const source =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { text?: unknown }).text
          : '';
    const text = plainText(source).replace(/\s+/g, ' ').slice(0, FORM_MAX_LENGTH);
    const key = text.toLowerCase();
    if (!text || key === title || seen.has(key) || /[*()|]/.test(text) || !isValidForm(text))
      continue;
    seen.add(key);
    const metadata =
      item && typeof item === 'object'
        ? pickMetadata((item as { metadata?: unknown }).metadata, FORM_METADATA_KEYS)
        : {};
    forms.push({ text, metadata });
  }
  return forms;
}
