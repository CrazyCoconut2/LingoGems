import {
  ELEMENT_SEARCH_MAX_LENGTH,
  languageDisplayName,
  normalizeMetadataVariability,
  type ElementMetadataVariability,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import {
  parseGeneratedDefinitions,
  VERBATIM_SENSE_TRANSLATION,
  VERBATIM_SENSE_TRANSLATION_FIELD,
  type GeneratedDefinition,
} from './definitions';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import {
  METADATA_VALUE_LANGUAGE_RULE,
  definitionSenseShape,
  metadataRuleLines,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
} from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import { translationLanguage } from './translation-settings';
import type { CompleteJsonInput } from './types';

const DISCOVER_COUNT = 5;
export const MAX_DISCOVER_INSTRUCTION = 200;
const MAX_DISCOVER_EXCLUDE = 200;

const DISCOVER_SENSE_COUNT = 2;
const DISCOVER_MAX_TOKENS = 4096;

type DiscoverMetadata = {
  definition?: ElementMetadataVariability;
  example?: ElementMetadataVariability;
  form?: ElementMetadataVariability;
};

type DiscoverElementsInput = {
  language: string;
  instruction?: string;
  metadata?: DiscoverMetadata;
  excludeTitles?: readonly string[];
  translation?: string;
};

export type DiscoveredElement = {
  title: string;
  senses: GeneratedDefinition[];
};

function buildDiscoverElementsUserMessage(input: DiscoverElementsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, input.translation);
  const instruction = (input.instruction ?? '').trim().slice(0, MAX_DISCOVER_INSTRUCTION);
  const metadata = metadataPayload(input.metadata);
  const excludeTitles = uniqueTitles(input.excludeTitles ?? [], MAX_DISCOVER_EXCLUDE);
  return JSON.stringify({
    language,
    writeFieldsIn,
    count: DISCOVER_COUNT,
    senses: DISCOVER_SENSE_COUNT,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    ...(instruction ? { instruction } : {}),
    ...(metadata ? { metadata } : {}),
    ...(excludeTitles.length ? { excludeTitles } : {}),
  });
}

/** Elements from a reply, or null when elements is missing or none of them can be used. */
function parseDiscoveredElements(
  parsed: unknown,
  language: string,
  translation = '',
): DiscoveredElement[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['elements'] : null;
  if (!Array.isArray(list)) return null;
  const elements: DiscoveredElement[] = [];
  for (const item of list) {
    if (elements.length >= DISCOVER_COUNT) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = titleOf(record['title']);
    if (!title || elements.some((element) => sameTitle(element.title, title))) continue;
    const senses = parseGeneratedDefinitions(record, {
      language,
      title,
      existingDefinitions: [],
      translation,
    });
    if (!senses?.length) continue;
    elements.push({
      title,
      senses: senses.slice(0, DISCOVER_SENSE_COUNT).map((sense) => ({
        text: sense.text,
        metadata: { ...sense.metadata },
      })),
    });
  }
  if (list.length > 0 && elements.length === 0) return null;
  return elements;
}

/** Ask the saved model for citation forms and their senses. */
export async function discoverElements(input: DiscoverElementsInput): Promise<DiscoveredElement[]> {
  const language = input.language.trim().toLowerCase();
  const request: CompleteJsonInput = {
    system: discoverSystemPrompt(),
    user: buildDiscoverElementsUserMessage(input),
    maxTokens: DISCOVER_MAX_TOKENS,
    temperature: 0.7,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) =>
      completeJson(provider, request, credentials),
    );
  try {
    const translation = input.translation ?? '';
    let elements = parseDiscoveredElements(await complete(), language, translation);
    if (!elements) elements = parseDiscoveredElements(await complete(), language, translation);
    if (!elements) aiError(AI_ERROR.RESPONSE_INVALID);
    return elements;
  } catch (err) {
    throw attachAiPrompt(err, request);
  }
}

function discoverSystemPrompt(): string {
  const fields = readDefinitionMetadataFields();
  const extra = readDefinitionExtraFields();
  const sense = definitionSenseShape(fields, extra);
  return [
    'You suggest dictionary elements for a language learner to add.',
    'JSON keys stay in English.',
    'writeFieldsIn is the learning language. Each title MUST be the citation form in that language. Do not use English unless writeFieldsIn is English.',
    'Every gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    fields.length || extra ? METADATA_VALUE_LANGUAGE_RULE : '',
    'count is how many elements to return.',
    'senses is how many senses to return for each title.',
    'instruction, when present, is a note from the learner in any language. Every element must fit that note.',
    'metadata, when present, orients the elements. It has definition, example, and form. Each is a map of English keys to values. Within one key, the values are alternatives: an element fits that key when it fits any listed value. An element must fit every key that is present, and every place that is present.',
    'When instruction and metadata are both absent, return a varied random set of useful citation forms for a learner of writeFieldsIn. Do not stay inside one topic.',
    'When instruction or metadata is present, every element must fit all of it. Do not pad with unrelated elements. An empty list is allowed when nothing new remains.',
    'excludeTitles, when present, are titles already shown or already in the collection. Do not repeat excludeTitles or inflections of them.',
    'Rules:',
    '- title is the generic citation form (infinitive for verbs)',
    '- One sense per distinct meaning',
    `- Return at most ${DISCOVER_SENSE_COUNT} senses for each title`,
    '- One short dictionary-style gloss per sense',
    '- A gloss MUST NOT contain the lemma or any inflected form of the lemma',
    '- Do not include examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in every title, gloss, and translation',
    '- Return at most count elements',
    '- Omit a title you cannot define',
    ...metadataRuleLines('definition', fields, extra),
    VERBATIM_SENSE_TRANSLATION,
    'Return JSON only with this shape:',
    `{"elements":[{"title":"<citation form>","senses":[${sense}]}]}`,
    VERBATIM_SENSE_TRANSLATION_FIELD,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function metadataPayload(
  metadata: DiscoverMetadata | undefined,
): Record<string, ElementMetadataVariability> | undefined {
  const definition = normalizeMetadataVariability(metadata?.definition);
  const example = normalizeMetadataVariability(metadata?.example);
  const form = normalizeMetadataVariability(metadata?.form);
  const payload: Record<string, ElementMetadataVariability> = {};
  if (Object.keys(definition).length) payload['definition'] = definition;
  if (Object.keys(example).length) payload['example'] = example;
  if (Object.keys(form).length) payload['form'] = form;
  return Object.keys(payload).length ? payload : undefined;
}

function titleOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, ELEMENT_SEARCH_MAX_LENGTH);
}

function uniqueTitles(titles: readonly string[], max: number): string[] {
  const unique: string[] = [];
  for (const raw of titles) {
    const title = titleOf(raw);
    if (!title || unique.some((item) => sameTitle(item, title))) continue;
    unique.push(title);
    if (unique.length >= max) break;
  }
  return unique;
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}
