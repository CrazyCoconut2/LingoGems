import {
  embedTranslation,
  languageDisplayName,
  parsePassage,
  type ElementMetadata,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import {
  exampleSentenceShape,
  metadataFieldKeys,
  metadataRuleLines,
  pickMetadata,
  readExampleMetadataFields,
  type AiMetadataField,
} from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const MAX_EXAMPLE_LENGTH = 500;
export const MAX_EXAMPLE_WORDS = 20;
export const MAX_EXAMPLE_INSTRUCTION = 400;
const EXAMPLES_MAX_TOKENS = 1024;

export function examplesSystemPrompt(
  fields: readonly AiMetadataField[] = readExampleMetadataFields(),
): string {
  const lines = [
    'You write one dictionary example sentence for one sense.',
    'JSON keys stay in English.',
    'The sentence MUST be in the language named by writeFieldsIn.',
    'Do not use English for the sentence unless writeFieldsIn is English.',
  ];
  if (fields.length) {
    lines.push('Do not copy English labels into metadata; write those values in writeFieldsIn.');
  }
  lines.push(
    'Rules:',
    '- Return exactly one example',
    '- When requiredForm is absent, the sentence MUST include the lemma, or an exact form listed in forms, naturally',
    '- When requiredForm is present, the sentence MUST contain that exact form. Do not use the lemma or a different inflection instead',
    '- Match the given gloss. Do not invent another sense',
    '- Write the sentence so the meaning of the lemma is obvious from the rest of the sentence. A learner who knows the other words should be able to tell what the lemma means immediately',
    '- exampleWords, when present, are words the learner chose to include. Use as many as fit naturally. Do not pull in other collection words. The array order is not an order to use in the sentence',
    "- exampleInstruction, when present, is the learner's note about the subject or the wording. Follow it. It does not override the other rules",
    '- Do not add citations or bracket tags such as [en:…]',
    '- Do not repeat existingExamples',
    `- Keep the sentence at most ${MAX_EXAMPLE_LENGTH} characters`,
    '- Spelling MUST be correct',
    ...metadataRuleLines('example', fields),
    'translateFieldsIn, when present, is English. Then the example MUST include "english", a faithful English translation of the sentence, with its first letter capitalized. When translateFieldsIn is absent, omit "english".',
    'Return JSON only with this shape:',
    `{"examples":[${exampleSentenceShape(fields)}]}`,
    'When translateFieldsIn is present, add "english":"<sentence in English>" on the example.',
  );
  return lines.join('\n');
}

export type GenerateExamplesInput = {
  language: string;
  title: string;
  gloss: string;
  partOfSpeech?: string;
  existingExamples: readonly string[];
  forms: readonly string[];
  exampleWords: readonly string[];
  exampleInstruction?: string;
  requiredForm?: string;
};

export type GeneratedExample = { text: string; metadata: ElementMetadata };

export function buildExamplesUserMessage(input: GenerateExamplesInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = language && language !== 'en' ? 'English' : '';
  const title = input.title.trim();
  const requiredForm = input.requiredForm?.trim() ?? '';
  const forms = requiredForm ? [] : uniqueTexts(input.forms);
  const words = exampleWords(title, input.exampleWords);
  const instruction = (input.exampleInstruction ?? '').trim().slice(0, MAX_EXAMPLE_INSTRUCTION);
  const pos = input.partOfSpeech?.trim() ?? '';
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: title,
    gloss: input.gloss.trim(),
    ...(pos ? { pos } : {}),
    existingExamples: uniqueTexts(input.existingExamples),
    exampleCount: 1,
    ...(words.length ? { exampleWords: words } : {}),
    ...(instruction ? { exampleInstruction: instruction } : {}),
    ...(requiredForm ? { requiredForm } : {}),
    ...(forms.length ? { forms } : {}),
  });
}

/** The sentence contains `form` as its own word, ignoring case. */
export function sentenceUsesForm(sentence: string, form: string): boolean {
  const needle = form.trim();
  if (!needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu').test(
    sentence,
  );
}

/** Usable examples, or null when the reply has no examples array. */
export function parseGeneratedExamples(
  parsed: unknown,
  input: GenerateExamplesInput,
): GeneratedExample[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['examples'] : null;
  if (!Array.isArray(list)) return null;
  const language = input.language.trim().toLowerCase();
  const taken = new Set(uniqueTexts(input.existingExamples).map((text) => text.toLowerCase()));
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const example = item as Record<string, unknown>;
    const sentence = parsePassage(plainText(example['text'])).text.replace(/\s+/g, ' ').trim();
    const key = sentence.toLowerCase();
    if (!sentence || sentence.length > MAX_EXAMPLE_LENGTH || taken.has(key)) continue;
    const english =
      language === 'en'
        ? ''
        : parsePassage(plainText(example['english'])).text.slice(0, MAX_EXAMPLE_LENGTH);
    return [
      {
        text: english ? embedTranslation(sentence, 'en', english) : sentence,
        metadata: pickMetadata(example['metadata'], metadataFieldKeys(readExampleMetadataFields())),
      },
    ];
  }
  return [];
}

/** Ask the saved model for one example sentence. */
export async function generateExamples(
  request: GenerateExamplesInput,
): Promise<GeneratedExample[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const gloss = request.gloss.trim();
  if (!title || !language || !gloss) return [];
  const ready = { ...request, title, language, gloss };
  const input: CompleteJsonInput = {
    system: examplesSystemPrompt(),
    user: buildExamplesUserMessage(ready),
    maxTokens: EXAMPLES_MAX_TOKENS,
    temperature: 0.4,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let examples = parseGeneratedExamples(await complete(), ready);
    if (!examples) examples = parseGeneratedExamples(await complete(), ready);
    if (!examples) aiError(AI_ERROR.RESPONSE_INVALID);
    return examples;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function exampleWords(title: string, words: readonly string[]): string[] {
  const lemma = title.trim().toLowerCase();
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const raw of words) {
    const text = raw.trim();
    const key = text.toLowerCase();
    if (!text || key === lemma || seen.has(key)) continue;
    seen.add(key);
    texts.push(text);
    if (texts.length >= MAX_EXAMPLE_WORDS) break;
  }
  return texts;
}
