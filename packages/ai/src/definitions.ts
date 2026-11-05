import {
  embedTranslation,
  isValidForm,
  languageDisplayName,
  normalizeDefinitionFrequency,
  parsePassage,
  type DefinitionFrequency,
  type ElementForm,
  type ElementMetadata,
} from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { MAX_EXAMPLE_LENGTH } from './examples';
import {
  definitionSenseShape,
  METADATA_VALUE_LANGUAGE_RULE,
  metadataFieldKeys,
  metadataRuleLines,
  pickMetadata,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  type AiMetadataField,
} from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import {
  readGenerateDefinitionTranslations,
  translationLanguage,
} from './translation-settings';
import type { CompleteJsonInput } from './types';

const MAX_SENSES = 8;
const META_VALUE_MAX_LENGTH = 100;
const FORM_MAX_LENGTH = 100;
const DEFINITIONS_MAX_TOKENS = 4096;
const FORMS_MAX_TOKENS = 8192;
const MAX_FORMS = 80;

const FORM_METADATA_KEYS = ['tense', 'person', 'number', 'mood'] as const;

const FREQUENCY_RULE =
  '- frequency is required on every sense and is exactly one of "common", "uncommon", "rare", "archaic", or "obsolete". common is everyday, uncommon is known but not everyday, rare is seldom met, archaic is old and out of normal use, obsolete is gone from living use. Write that word in English';

const NO_SELF_MENTION = '- A gloss MUST NOT contain the lemma or any inflected form of the lemma';

const FORM_SHAPE = `{"text":"<surface form>","metadata":{"tense":"<in writeFieldsIn>","person":"<in writeFieldsIn>","number":"<in writeFieldsIn>","mood":"<in writeFieldsIn>"}}`;

export function definitionsSystemPrompt(fields: readonly AiMetadataField[], extra = false): string {
  return joinPrompt([
    'You write dictionary senses for one headword.',
    'JSON keys stay in English.',
    'Every gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    metadataIntro(fields, extra),
    'Rules:',
    '- One sense per distinct meaning',
    '- Do not repeat a meaning or a gloss already listed in existingDefinitions. Those are senses already kept, and they include no forms',
    `- Return at most ${MAX_SENSES} senses`,
    '- One short dictionary-style gloss per sense',
    NO_SELF_MENTION,
    '- Do not include examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in every gloss and English gloss',
    FREQUENCY_RULE,
    ...metadataRuleLines('definition', fields, extra),
    'translateFieldsIn, when present, is English. Then each sense MUST include "english", a faithful English gloss of that sense, with its first letter capitalized. When translateFieldsIn is absent, omit "english".',
    'Return JSON only with this shape:',
    `{"senses":[${definitionSenseShape(fields, extra)}]}`,
    'When translateFieldsIn is present, add "english":"<gloss in English>" on each sense.',
  ]);
}

export function elementFromSelectionSystemPrompt(
  fields: readonly AiMetadataField[],
  extra = false,
): string {
  return joinPrompt([
    'You add one dictionary element from a selected word or phrase.',
    'JSON keys stay in English.',
    'Every gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    metadataIntro(fields, extra),
    'Rules:',
    "- lemma is the citation form of the selection, the root headword, in the selection's language. When the selection is already that form, lemma is the selection. Do not choose a different word",
    '- One sense per distinct meaning of that lemma',
    `- Return at most ${MAX_SENSES} senses`,
    '- One short dictionary-style gloss per sense',
    NO_SELF_MENTION,
    '- Do not include examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in the lemma, every gloss, and every English gloss',
    FREQUENCY_RULE,
    ...metadataRuleLines('definition', fields, extra),
    'translateFieldsIn, when present, is English. Then each sense MUST include "english", a faithful English gloss of that sense, with its first letter capitalized. When translateFieldsIn is absent, omit "english".',
    'Return JSON only with this shape:',
    `{"lemma":"<root lemma>","senses":[${definitionSenseShape(fields, extra)}]}`,
    'When translateFieldsIn is present, add "english":"<gloss in English>" on each sense.',
  ]);
}

export function definitionFromExampleSystemPrompt(
  fields: readonly AiMetadataField[],
  extra = false,
): string {
  return joinPrompt([
    'You write one dictionary sense for a headword from one example sentence.',
    'JSON keys stay in English.',
    'The gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    metadataIntro(fields, extra),
    'Rules:',
    '- Return exactly one sense: the meaning of the lemma as it is used in example',
    '- Do not define a different meaning',
    '- Do not repeat a meaning or a gloss already listed in existingDefinitions',
    '- One short dictionary-style gloss',
    NO_SELF_MENTION,
    '- Do not include the example, other examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in the gloss and the English gloss',
    FREQUENCY_RULE,
    ...metadataRuleLines('definition', fields, extra),
    'translateFieldsIn, when present, is English. Then the sense MUST include "english", a faithful English gloss of that sense, with its first letter capitalized. When translateFieldsIn is absent, omit "english".',
    'Return JSON only with this shape:',
    `{"senses":[${definitionSenseShape(fields, extra)}]}`,
    'When translateFieldsIn is present, add "english":"<gloss in English>" on the sense.',
  ]);
}

function metadataIntro(fields: readonly AiMetadataField[], extra = false): string {
  return fields.length || extra
    ? METADATA_VALUE_LANGUAGE_RULE
    : '';
}

function joinPrompt(lines: readonly string[]): string {
  return lines.filter((line) => line !== '').join('\n');
}

export const FORMS_SYSTEM_PROMPT = `You list the surface forms of one dictionary sense.
JSON keys stay in English.
${METADATA_VALUE_LANGUAGE_RULE}
Rules:
- forms lists every distinct inflected surface form of this sense, not one example. For a verb, cover person, number, tense, and mood, plus the participle and gerund when they exist. For a noun or adjective, cover gender and number. Keep going until that paradigm is covered. Omit a form you cannot spell correctly
- The forms array in the shape shows the fields. It is not a limit of one form
- Include the headword itself as one form. Do not repeat a form listed in existingForms
- No wildcards, regex, parentheses, or asterisks in a form
- Form metadata keys are only "tense", "person", "number", and "mood". Omit a pair when it does not apply
- Spelling MUST be correct in every form
Return JSON only with this shape:
{"forms":[${FORM_SHAPE}]}`;

export type GenerateDefinitionsInput = {
  language: string;
  title: string;
  existingDefinitions: ReadonlyArray<{
    text: string;
    metadata: ElementMetadata;
    frequency?: unknown;
  }>;
};

export type GenerateDefinitionFromExampleInput = GenerateDefinitionsInput & {
  example: string;
};

export type GeneratedDefinition = {
  text: string;
  metadata: ElementMetadata;
  frequency: DefinitionFrequency;
};

export type GenerateFormsInput = {
  language: string;
  title: string;
  gloss: string;
  existingForms: string[];
};

export function buildDefinitionsUserMessage(input: GenerateDefinitionsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, readGenerateDefinitionTranslations(language));
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    existingDefinitions: describedDefinitions(language, input.existingDefinitions),
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
  const taken = new Set(
    describedDefinitions(language, input.existingDefinitions).map((definition) =>
      definition.gloss.toLowerCase(),
    ),
  );
  const definitions: GeneratedDefinition[] = [];
  for (const item of list) {
    if (definitions.length >= MAX_SENSES) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const sense = item as Record<string, unknown>;
    const gloss = glossText(sense['gloss'] ?? sense['glosses']);
    if (!gloss || taken.has(gloss.toLowerCase())) continue;
    taken.add(gloss.toLowerCase());
    const english =
      language === 'en' || !readGenerateDefinitionTranslations(language)
        ? ''
        : plainText(sense['english']).slice(0, META_VALUE_MAX_LENGTH);
    definitions.push({
      text: english ? embedTranslation(gloss, 'en', english) : gloss,
      metadata: pickMetadata(
        sense['metadata'],
        metadataFieldKeys(readDefinitionMetadataFields(language)),
        readDefinitionExtraFields(language),
      ),
      frequency: normalizeDefinitionFrequency(sense['frequency']),
    });
  }
  return definitions;
}

export function buildDefinitionFromExampleUserMessage(
  input: GenerateDefinitionFromExampleInput,
): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, readGenerateDefinitionTranslations(language));
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    example: input.example.trim().slice(0, MAX_EXAMPLE_LENGTH),
    existingDefinitions: describedDefinitions(language, input.existingDefinitions),
  });
}

/** One sense for the way the headword is used in the example, or null when nothing usable comes back. */
export async function generateDefinitionFromExample(
  request: GenerateDefinitionFromExampleInput,
): Promise<GeneratedDefinition | null> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const example = request.example.trim().slice(0, MAX_EXAMPLE_LENGTH);
  if (!title || !language || !example) return null;
  const prepared = { ...request, title, language, example };
  const input: CompleteJsonInput = {
    system: definitionFromExampleSystemPrompt(
      readDefinitionMetadataFields(language),
      readDefinitionExtraFields(language),
    ),
    user: buildDefinitionFromExampleUserMessage(prepared),
    maxTokens: 1024,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let senses = parseGeneratedDefinitions(await complete(), prepared);
    if (!senses) senses = parseGeneratedDefinitions(await complete(), prepared);
    if (!senses) aiError(AI_ERROR.RESPONSE_INVALID);
    return senses[0] ?? null;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

export type GenerateElementFromSelectionInput = {
  language: string;
  selected: string;
  context: string;
};

export type GeneratedElement = {
  lemma: string;
  definitions: GeneratedDefinition[];
};

export function buildElementFromSelectionUserMessage(
  input: GenerateElementFromSelectionInput,
): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, readGenerateDefinitionTranslations(language));
  const context = input.context.trim().slice(0, MAX_EXAMPLE_LENGTH);
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    selected: input.selected.trim(),
    ...(context ? { context } : {}),
  });
}

/** The root lemma and its senses, or null when the reply has neither. */
export async function generateElementFromSelection(
  request: GenerateElementFromSelectionInput,
): Promise<GeneratedElement | null> {
  const selected = request.selected.trim();
  const language = request.language.trim().toLowerCase();
  const context = request.context.trim().slice(0, MAX_EXAMPLE_LENGTH);
  if (!selected || !language) return null;
  const prepared = { ...request, selected, language, context };
  const input: CompleteJsonInput = {
    system: elementFromSelectionSystemPrompt(
      readDefinitionMetadataFields(language),
      readDefinitionExtraFields(language),
    ),
    user: buildElementFromSelectionUserMessage(prepared),
    maxTokens: DEFINITIONS_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let element = parseGeneratedElement(await complete(), prepared);
    if (!element) element = parseGeneratedElement(await complete(), prepared);
    if (!element) aiError(AI_ERROR.RESPONSE_INVALID);
    return element;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function parseGeneratedElement(
  parsed: unknown,
  input: GenerateElementFromSelectionInput,
): GeneratedElement | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const lemma = plainText(source?.['lemma']).replace(/\s+/g, ' ').slice(0, FORM_MAX_LENGTH);
  if (!lemma) return null;
  const definitions = parseGeneratedDefinitions(parsed, {
    language: input.language,
    title: lemma,
    existingDefinitions: [],
  });
  if (!definitions) return null;
  return { lemma, definitions };
}

/** Ask the saved model for senses this headword does not already have. */
export async function generateDefinitions(
  request: GenerateDefinitionsInput,
): Promise<GeneratedDefinition[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  if (!title || !language) return [];
  const input: CompleteJsonInput = {
    system: definitionsSystemPrompt(
      readDefinitionMetadataFields(language),
      readDefinitionExtraFields(language),
    ),
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

function describedDefinitions(
  language: string,
  definitions: ReadonlyArray<{ text: string; metadata: ElementMetadata; frequency?: unknown }>,
): Array<{ gloss: string; english?: string; frequency: DefinitionFrequency; metadata?: ElementMetadata }> {
  const described: Array<{
    gloss: string;
    english?: string;
    frequency: DefinitionFrequency;
    metadata?: ElementMetadata;
  }> = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const passage = parsePassage(definition.text ?? '');
    const gloss = passage.text.trim();
    const key = gloss.toLowerCase();
    if (!gloss || seen.has(key)) continue;
    seen.add(key);
    const english = passage.translations.find((item) => item.language === 'en')?.text.trim();
    const metadata = pickMetadata(
      definition.metadata,
      metadataFieldKeys(readDefinitionMetadataFields(language)),
      readDefinitionExtraFields(language),
    );
    described.push({
      gloss,
      frequency: normalizeDefinitionFrequency(definition.frequency),
      ...(english ? { english } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });
  }
  return described;
}

function glossText(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return parsePassage(plainText(raw)).text.replace(/\s+/g, ' ').trim();
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildFormsUserMessage(input: GenerateFormsInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  return JSON.stringify({
    language,
    writeFieldsIn,
    lemma: input.title.trim(),
    gloss: input.gloss.trim(),
    existingForms: input.existingForms.map((form) => form.trim()).filter(Boolean),
  });
}

/** Usable forms, or null when the reply has no forms array. */
export function parseGeneratedForms(
  parsed: unknown,
  input: GenerateFormsInput,
): ElementForm[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['forms'] : null;
  if (!Array.isArray(list)) return null;
  const title = input.title.trim();
  const taken = new Set(
    input.existingForms.map((form) => form.trim().toLowerCase()).filter(Boolean),
  );
  return parseForms(list, title, taken);
}

/** Ask the saved model for surface forms of one sense. */
export async function generateForms(request: GenerateFormsInput): Promise<ElementForm[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const gloss = request.gloss.trim();
  if (!title || !language || !gloss) return [];
  const input: CompleteJsonInput = {
    system: FORMS_SYSTEM_PROMPT,
    user: buildFormsUserMessage({ ...request, title, language, gloss }),
    maxTokens: FORMS_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let forms = parseGeneratedForms(await complete(), { ...request, title, language, gloss });
    if (!forms)
      forms = parseGeneratedForms(await complete(), { ...request, title, language, gloss });
    if (!forms) aiError(AI_ERROR.RESPONSE_INVALID);
    return forms;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

function parseForms(value: unknown, title: string, taken: ReadonlySet<string>): ElementForm[] {
  if (!Array.isArray(value)) return [];
  const lemma = title.trim();
  const lemmaKey = lemma.toLowerCase();
  const seen = new Set(taken);
  const forms: ElementForm[] = [];
  for (const item of value) {
    if (forms.length >= MAX_FORMS) break;
    const source =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { text?: unknown }).text
          : '';
    const text = plainText(source).replace(/\s+/g, ' ').slice(0, FORM_MAX_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || /[*()|]/.test(text) || !isValidForm(text)) continue;
    seen.add(key);
    const metadata =
      item && typeof item === 'object'
        ? pickMetadata((item as { metadata?: unknown }).metadata, FORM_METADATA_KEYS)
        : {};
    forms.push({ text, metadata });
  }
  if (
    lemma &&
    !seen.has(lemmaKey) &&
    forms.length < MAX_FORMS &&
    !/[*()|]/.test(lemma) &&
    isValidForm(lemma)
  ) {
    forms.unshift({ text: lemma, metadata: {} });
  }
  return forms;
}
