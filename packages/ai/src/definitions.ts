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
import { MAX_EXAMPLE_LENGTH } from './examples';
import {
  definitionSenseShape,
  formEntryShape,
  METADATA_VALUE_LANGUAGE_RULE,
  metadataFieldKeys,
  metadataRuleLines,
  pickMetadata,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  readFormExtraFields,
  readFormMetadataFields,
  type AiMetadataField,
} from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import { translationLanguage, translationTarget } from './translation-settings';
import type { CompleteJsonInput } from './types';

const MAX_SENSES = 8;
const META_VALUE_MAX_LENGTH = 100;
const FORM_MAX_LENGTH = 100;
const DEFINITIONS_MAX_TOKENS = 4096;
const FORMS_MAX_TOKENS = 8192;
const MAX_FORMS = 80;

const NO_SELF_MENTION = '- A gloss MUST NOT contain the lemma or any inflected form of the lemma';

export const VERBATIM_SENSE_TRANSLATION =
  'translateFieldsIn, when present, names the translation language. Then each sense MUST include "translation", a verbatim translation of that sense\'s gloss. Translate the gloss text itself, in the same order and with the same wording. Do not paraphrase, shorten, or replace it with a different gloss. Capitalize the first letter. When translateFieldsIn is absent, omit "translation".';

export const VERBATIM_SENSE_TRANSLATION_FIELD =
  'When translateFieldsIn is present, add "translation":"<verbatim translation of the gloss>" on each sense.';

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
    '- Spelling MUST be correct in every gloss and its translation',
    ...metadataRuleLines('definition', fields, extra),
    VERBATIM_SENSE_TRANSLATION,
    'Return JSON only with this shape:',
    `{"senses":[${definitionSenseShape(fields, extra)}]}`,
    VERBATIM_SENSE_TRANSLATION_FIELD,
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
    '- selected is written in writeFieldsIn. When it is copied from a definition or an example, that text is in the language of the definition or example, which is writeFieldsIn. It is not written in translateFieldsIn',
    '- context, when present, is that definition or example, also written in writeFieldsIn',
    '- lemma is the citation form of selected in writeFieldsIn. When selected is already that form, lemma is selected. Do not translate selected into another language and do not choose a different word',
    '- One sense per distinct meaning of that lemma',
    `- Return at most ${MAX_SENSES} senses`,
    '- One short dictionary-style gloss per sense',
    NO_SELF_MENTION,
    '- Do not include examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in the lemma, every gloss, and every translation',
    ...metadataRuleLines('definition', fields, extra),
    VERBATIM_SENSE_TRANSLATION,
    'Return JSON only with this shape:',
    `{"lemma":"<root lemma>","senses":[${definitionSenseShape(fields, extra)}]}`,
    VERBATIM_SENSE_TRANSLATION_FIELD,
  ]);
}

export function definitionFromExampleSystemPrompt(
  fields: readonly AiMetadataField[],
  extra = false,
): string {
  return joinPrompt([
    'You place one example sentence on a dictionary headword.',
    'JSON keys stay in English.',
    'The gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    metadataIntro(fields, extra),
    'Rules:',
    '- If the example uses a meaning already listed in existingDefinitions, return {"match":"<that gloss exactly as listed>"} and nothing else',
    '- Otherwise return exactly one new sense: the meaning of the lemma as it is used in the example',
    '- Do not define a different meaning',
    '- One short dictionary-style gloss',
    NO_SELF_MENTION,
    '- Do not include the example, other examples, forms, or citations',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in the gloss and its translation',
    ...metadataRuleLines('definition', fields, extra),
    'translateFieldsIn, when present, names the translation language. A new sense MUST include "translation", a verbatim translation of that sense\'s gloss. Translate the gloss text itself, in the same order and with the same wording. Do not paraphrase, shorten, or replace it with a different gloss. Capitalize the first letter. A match does not include a translation. When translateFieldsIn is absent, omit "translation".',
    'A new sense uses this shape:',
    `{"senses":[${definitionSenseShape(fields, extra)}]}`,
    'When translateFieldsIn is present, add "translation":"<verbatim translation of the gloss>" on the new sense.',
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

export function formsSystemPrompt(fields: readonly AiMetadataField[], extra = false): string {
  return joinPrompt([
    'You list the inflected forms of one lemma.',
    'JSON keys stay in English.',
    METADATA_VALUE_LANGUAGE_RULE,
    'Rules:',
    '- Each form is only a spelling of the lemma itself. Vary that one element. Do not add any other word around it',
    '- Do not include pronouns, articles, auxiliaries, clitics, prepositions, or any word that is not part of the lemma.',
    '- Person, number, tense, and mood belong in metadata, not as extra words in the form',
    '- A separable lemma may split into its own parts, as in "rufe an" for anrufen, and still must not add a subject or any other word',
    '- forms lists every distinct inflected form of this lemma, not one example and not a phrase. For a verb, cover person, number, tense, and mood, plus the participle and gerund when they exist. For a noun or adjective, cover gender and number. Keep going until that paradigm is covered. Omit a form you cannot spell correctly',
    '- The forms array in the shape shows the fields. It is not a limit of one form',
    '- Include the headword itself as one form. Do not repeat a form listed in existingForms',
    '- No wildcards, regex, parentheses, or asterisks in a form',
    ...metadataRuleLines('form', fields, extra),
    '- Spelling MUST be correct in every form',
    'Return JSON only with this shape:',
    `{"forms":[${formEntryShape(fields, extra)}]}`,
  ]);
}

export type GenerateDefinitionsInput = {
  language: string;
  title: string;
  existingDefinitions: ReadonlyArray<{
    text: string;
    metadata: ElementMetadata;
  }>;
  translation?: string;
};

export type GenerateDefinitionFromExampleInput = GenerateDefinitionsInput & {
  example: string;
};

export type GeneratedDefinition = {
  text: string;
  metadata: ElementMetadata;
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
  const translateFieldsIn = translationLanguage(language, input.translation);
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    existingDefinitions: describedDefinitions(
      language,
      input.existingDefinitions,
      input.translation ?? '',
    ),
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
    describedDefinitions(language, input.existingDefinitions, input.translation ?? '').map((definition) =>
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
    const english = takenTranslation(language, sense['translation'] ?? sense['english'], input.translation ?? '');
    const into = translationTarget(language, input.translation);
    definitions.push({
      text: english && into ? embedTranslation(gloss, into, english) : gloss,
      metadata: pickMetadata(
        sense['metadata'],
        metadataFieldKeys(readDefinitionMetadataFields(language)),
        readDefinitionExtraFields(language),
      ),
    });
  }
  return definitions;
}

export function buildDefinitionFromExampleUserMessage(
  input: GenerateDefinitionFromExampleInput,
): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, input.translation);
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    example: input.example.trim().slice(0, MAX_EXAMPLE_LENGTH),
    existingDefinitions: describedDefinitions(
      language,
      input.existingDefinitions,
      input.translation ?? '',
    ),
  });
}

/** Where one example sentence belongs: an existing sense, or a new one. */
export type ExamplePlacement =
  | { kind: 'existing'; gloss: string }
  | { kind: 'new'; definition: GeneratedDefinition };

function matchingGloss(
  gloss: string,
  existing: ReadonlyArray<{ gloss: string }>,
): string {
  const key = gloss.trim().toLowerCase();
  if (!key) return '';
  return existing.find((definition) => definition.gloss.toLowerCase() === key)?.gloss ?? '';
}

/** An existing sense for the example, a new sense, or null when the reply is unusable. */
export function parseExamplePlacement(
  parsed: unknown,
  input: GenerateDefinitionFromExampleInput,
): ExamplePlacement | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const existing = describedDefinitions(
    input.language,
    input.existingDefinitions,
    input.translation ?? '',
  );
  const matched = matchingGloss(glossText(source['match']), existing);
  if (matched) return { kind: 'existing', gloss: matched };
  const senses = parseGeneratedDefinitions(parsed, input);
  if (senses?.[0]) return { kind: 'new', definition: senses[0] };
  const list = source['senses'];
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const gloss = matchingGloss(glossText((item as Record<string, unknown>)['gloss']), existing);
    if (gloss) return { kind: 'existing', gloss };
  }
  return null;
}

/** Place the example on an existing sense, or write one new sense. Null when nothing usable comes back. */
export async function generateDefinitionFromExample(
  request: GenerateDefinitionFromExampleInput,
): Promise<ExamplePlacement | null> {
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
    let placed = parseExamplePlacement(await complete(), prepared);
    if (!placed) placed = parseExamplePlacement(await complete(), prepared);
    if (!placed) aiError(AI_ERROR.RESPONSE_INVALID);
    return placed;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

export type GenerateElementFromSelectionInput = {
  language: string;
  selected: string;
  context: string;
  translation?: string;
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
  const translateFieldsIn = translationLanguage(language, input.translation);
  const context = input.context.trim().slice(0, MAX_EXAMPLE_LENGTH);
  return JSON.stringify({
    language,
    writeFieldsIn,
    selectedIn: writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    selected: input.selected.trim(),
    ...(context ? { context, contextIn: writeFieldsIn } : {}),
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
    translation: input.translation,
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
  definitions: ReadonlyArray<{ text: string; metadata: ElementMetadata }>,
  translation: string,
): Array<{ gloss: string; translation?: string; metadata?: ElementMetadata }> {
  const described: Array<{
    gloss: string;
    translation?: string;
    metadata?: ElementMetadata;
  }> = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const passage = parsePassage(definition.text ?? '');
    const gloss = passage.text.trim();
    const key = gloss.toLowerCase();
    if (!gloss || seen.has(key)) continue;
    seen.add(key);
    const into = translationTarget(language, translation);
    const english = into
      ? passage.translations.find((item) => item.language === into)?.text.trim()
      : '';
    const metadata = pickMetadata(
      definition.metadata,
      metadataFieldKeys(readDefinitionMetadataFields(language)),
      readDefinitionExtraFields(language),
    );
    described.push({
      gloss,
      ...(english ? { translation: english } : {}),
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

function takenTranslation(language: string, raw: unknown, translation: string): string {
  if (!translationLanguage(language, translation)) return '';
  return plainText(raw).slice(0, META_VALUE_MAX_LENGTH);
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
  const language = input.language.trim().toLowerCase();
  return parseForms(list, title, taken, language);
}

/** Ask the saved model for surface forms of one sense. */
export async function generateForms(request: GenerateFormsInput): Promise<ElementForm[]> {
  const title = request.title.trim();
  const language = request.language.trim().toLowerCase();
  const gloss = request.gloss.trim();
  if (!title || !language || !gloss) return [];
  const input: CompleteJsonInput = {
    system: formsSystemPrompt(readFormMetadataFields(language), readFormExtraFields(language)),
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

function parseForms(
  value: unknown,
  title: string,
  taken: ReadonlySet<string>,
  language: string,
): ElementForm[] {
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
        ? pickMetadata(
            (item as { metadata?: unknown }).metadata,
            metadataFieldKeys(readFormMetadataFields(language)),
            readFormExtraFields(language),
          )
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
