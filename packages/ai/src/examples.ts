import { languageDisplayName, parsePassage, type ElementMetadata } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import {
  exampleSentenceShape,
  METADATA_VALUE_LANGUAGE_RULE,
  metadataFieldKeys,
  metadataRuleLines,
  pickMetadata,
  readExampleExtraFields,
  readExampleMetadataFields,
  type AiMetadataField,
} from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const MAX_EXAMPLE_LENGTH = 500;
const MAX_EXAMPLE_WORDS = 20;
export const MAX_EXAMPLE_INSTRUCTION = 400;
const EXAMPLES_MAX_TOKENS = 1024;

function examplesSystemPrompt(fields: readonly AiMetadataField[], extra = false): string {
  const lines = [
    'You write one dictionary example sentence for one sense.',
    'JSON keys stay in English.',
    'The sentence MUST be in the language named by writeFieldsIn.',
    'Do not use English for the sentence unless writeFieldsIn is English.',
  ];
  if (fields.length || extra) {
    lines.push(METADATA_VALUE_LANGUAGE_RULE);
  }
  lines.push(
    'Rules:',
    '- Return exactly one example',
    '- When requiredForm is absent, the sentence MUST include the lemma, or an exact form listed in forms, naturally',
    '- When requiredForm is present, the sentence MUST contain that exact form. Do not use the lemma or a different inflection instead',
    '- Match the given gloss. Do not invent another sense',
    "- metadata, when present, is that sense's metadata. The sentence must agree with it",
    '- Write the sentence so the meaning of the lemma is obvious from the rest of the sentence. A learner who knows the other words should be able to tell what the lemma means immediately',
    '- exampleWords, when present, are words the learner chose to include. Use as many as fit naturally. Do not pull in other collection words. The array order is not an order to use in the sentence',
    "- exampleInstruction, when present, is the learner's note about the subject or the wording. Follow it. It does not override the other rules",
    '- currentExample, when present, is the sentence to revise. Return that sentence changed to follow exampleInstruction. Do not write a different example',
    '- Do not add citations or bracket tags such as [en: …]',
    '- Do not repeat existingExamples',
    `- Keep the sentence at most ${MAX_EXAMPLE_LENGTH} characters`,
    '- Spelling MUST be correct',
    ...metadataRuleLines('example', fields, extra),
    'Return JSON only with this shape:',
    `{"examples":[${exampleSentenceShape(fields, extra)}]}`,
  );
  return lines.join('\n');
}

type GenerateExamplesInput = {
  language: string;
  title: string;
  gloss: string;
  metadata?: ElementMetadata;
  existingExamples: readonly string[];
  forms: readonly string[];
  exampleWords: readonly string[];
  exampleInstruction?: string;
  /** Sentence to revise. Absent when the learner wants a new example. */
  currentExample?: string;
  requiredForm?: string;
  translation?: string;
};

type GeneratedExample = { text: string; metadata: ElementMetadata };

function buildExamplesUserMessage(input: GenerateExamplesInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const title = input.title.trim();
  const requiredForm = input.requiredForm?.trim() ?? '';
  const forms = requiredForm ? [] : uniqueTexts(input.forms);
  const words = exampleWords(title, input.exampleWords);
  const instruction = (input.exampleInstruction ?? '').trim().slice(0, MAX_EXAMPLE_INSTRUCTION);
  const currentExample = (input.currentExample ?? '').trim().slice(0, MAX_EXAMPLE_LENGTH);
  const metadata = senseMetadata(input.metadata);
  return JSON.stringify({
    language,
    writeFieldsIn,
    lemma: title,
    gloss: input.gloss.trim(),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    existingExamples: uniqueTexts(input.existingExamples),
    exampleCount: 1,
    ...(words.length ? { exampleWords: words } : {}),
    ...(instruction ? { exampleInstruction: instruction } : {}),
    ...(currentExample ? { currentExample } : {}),
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
function parseGeneratedExamples(
  parsed: unknown,
  input: GenerateExamplesInput,
): GeneratedExample[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['examples'] : null;
  if (!Array.isArray(list)) return null;
  const taken = new Set(uniqueTexts(input.existingExamples).map((text) => text.toLowerCase()));
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const example = item as Record<string, unknown>;
    const sentence = parsePassage(plainText(example['text'])).text.replace(/\s+/g, ' ').trim();
    const key = sentence.toLowerCase();
    if (!sentence || sentence.length > MAX_EXAMPLE_LENGTH || taken.has(key)) continue;
    return [
      {
        text: sentence,
        metadata: pickMetadata(
          example['metadata'],
          metadataFieldKeys(readExampleMetadataFields()),
          readExampleExtraFields(),
        ),
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
    system: examplesSystemPrompt(readExampleMetadataFields(), readExampleExtraFields()),
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

function senseMetadata(metadata: ElementMetadata | undefined): ElementMetadata {
  const next: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(metadata ?? {})) {
    const key = rawKey.trim();
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!key || !value) continue;
    next[key] = value;
  }
  return next;
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

const DERIVED_EXAMPLE_MAX_TOKENS = 512;

type GenerateDerivedExampleInput = {
  language: string;
  root: string;
  definition: string;
  selected: string;
  translation?: string;
};

function derivedExampleSystemPrompt(): string {
  return [
    'You write one example sentence that restates a dictionary gloss.',
    'JSON keys stay in English.',
    'The sentence MUST be in the language named by writeFieldsIn.',
    'Do not use English for the sentence unless writeFieldsIn is English.',
    'Rules:',
    "- root is a headword. definition is that headword's gloss. selected is a word or phrase taken from that gloss. All three are written in writeFieldsIn",
    '- Return exactly one sentence. It MUST use the root headword and selected, and it MUST restate definition',
    '- If root is "Marathon", selected is "Lauf", and definition is "Lauf über 42.195 km", the sentence says that a Marathon is a Lauf of over 42.195 km',
    '- Do not write a dictionary gloss. Do not add citations or bracket tags such as [en:…]',
    `- Keep the sentence at most ${MAX_EXAMPLE_LENGTH} characters`,
    '- Spelling MUST be correct',
    'Return JSON only with this shape:',
    '{"example":"<sentence in writeFieldsIn>"}',
  ].join('\n');
}

function parseDerivedExample(parsed: unknown): string {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const sentence = parsePassage(plainText(source?.['example'] ?? source?.['text']))
    .text.replace(/\s+/g, ' ')
    .trim();
  if (!sentence || sentence.length > MAX_EXAMPLE_LENGTH) return '';
  return sentence;
}

/** One sentence that restates a parent gloss with its headword and the selected word. Empty when nothing usable comes back. */
export async function generateDerivedExample(
  request: GenerateDerivedExampleInput,
): Promise<string> {
  const language = request.language.trim().toLowerCase();
  const root = request.root.replace(/\s+/g, ' ').trim();
  const definition = request.definition.replace(/\s+/g, ' ').trim().slice(0, MAX_EXAMPLE_LENGTH);
  const selected = request.selected.replace(/\s+/g, ' ').trim();
  if (!language || !root || !definition || !selected) return '';
  const writeFieldsIn = languageDisplayName(language) || language;
  const input: CompleteJsonInput = {
    system: derivedExampleSystemPrompt(),
    user: JSON.stringify({
      language,
      writeFieldsIn,
      root,
      definition,
      selected,
    }),
    maxTokens: DERIVED_EXAMPLE_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let sentence = parseDerivedExample(await complete());
    if (!sentence) sentence = parseDerivedExample(await complete());
    return sentence;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
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
