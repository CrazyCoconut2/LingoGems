import {
  ELEMENT_SEARCH_MAX_LENGTH,
  languageDisplayName,
  normalizeMetadataVariability,
  type ElementMetadataVariability,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const DISCOVER_COUNT = 20;
export const MAX_DISCOVER_INSTRUCTION = 200;
export const MAX_DISCOVER_EXCLUDE = 200;

const DISCOVER_MAX_TOKENS = 2048;

const DISCOVER_SYSTEM_PROMPT = `You suggest dictionary element titles for a language learner to add.
JSON keys stay in English.
writeFieldsIn is the learning language. Each title MUST be the citation form in that language. Do not use English unless writeFieldsIn is English.
count is how many titles to return.
instruction, when present, is a note from the learner in any language. Every title must fit that note.
metadata, when present, orients the titles. It has definition, example, and form. Each is a map of English keys to values. Within one key, the values are alternatives: a title fits that key when it fits any listed value. A title must fit every key that is present, and every place that is present.
When instruction and metadata are both absent, return a varied random set of useful citation forms for a learner of writeFieldsIn. Do not stay inside one topic.
When instruction or metadata is present, every title must fit all of it. Do not pad with unrelated titles. An empty list is allowed when nothing new remains.
excludeTitles, when present, are titles already shown or already in the collection. Do not repeat excludeTitles or inflections of them.
Rules:
- title is the generic citation form (infinitive for verbs)
- Return only the title
- Do not return definitions, explanations, parts of speech, inflections, translations, or examples
- Return at most count titles
Return JSON only with this shape:
{"elements":[{"title":"<citation form>"}]}`;

export type DiscoverMetadata = {
  definition?: ElementMetadataVariability;
  example?: ElementMetadataVariability;
  form?: ElementMetadataVariability;
};

export type DiscoverElementsInput = {
  language: string;
  instruction?: string;
  metadata?: DiscoverMetadata;
  excludeTitles?: readonly string[];
};

export function buildDiscoverElementsUserMessage(input: DiscoverElementsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const instruction = (input.instruction ?? '').trim().slice(0, MAX_DISCOVER_INSTRUCTION);
  const metadata = metadataPayload(input.metadata);
  const excludeTitles = uniqueTitles(input.excludeTitles ?? [], MAX_DISCOVER_EXCLUDE);
  return JSON.stringify({
    language,
    writeFieldsIn,
    count: DISCOVER_COUNT,
    ...(instruction ? { instruction } : {}),
    ...(metadata ? { metadata } : {}),
    ...(excludeTitles.length ? { excludeTitles } : {}),
  });
}

/** Titles from a reply, or null when elements is missing or unusable. */
export function parseDiscoveredElements(parsed: unknown): string[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['elements'] : null;
  if (!Array.isArray(list)) return null;
  const titles = uniqueTitles(
    list.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
      const title = (item as { title?: unknown }).title;
      return typeof title === 'string' ? title : '';
    }),
    DISCOVER_COUNT,
  );
  if (list.length > 0 && titles.length === 0) return null;
  return titles;
}

/** Ask the saved model for citation titles to add. */
export async function discoverElements(input: DiscoverElementsInput): Promise<string[]> {
  const request: CompleteJsonInput = {
    system: DISCOVER_SYSTEM_PROMPT,
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
    let titles = parseDiscoveredElements(await complete());
    if (!titles) titles = parseDiscoveredElements(await complete());
    if (!titles) aiError(AI_ERROR.RESPONSE_INVALID);
    return titles;
  } catch (err) {
    throw attachAiPrompt(err, request);
  }
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

function uniqueTitles(titles: readonly string[], max: number): string[] {
  const unique: string[] = [];
  for (const raw of titles) {
    const title = raw.replace(/\s+/g, ' ').trim().slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    if (!title || unique.some((item) => sameTitle(item, title))) continue;
    unique.push(title);
    if (unique.length >= max) break;
  }
  return unique;
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}
