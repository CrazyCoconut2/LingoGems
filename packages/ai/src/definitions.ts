import {
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
import { generateEquivalent } from './translate';
import type { CompleteJsonInput } from './types';

const MAX_SENSES = 8;
const FORM_MAX_LENGTH = 100;
const DEFINITIONS_MAX_TOKENS = 4096;
const FORMS_MAX_TOKENS = 8192;
const MAX_FORMS = 80;

const NO_SELF_MENTION = '- A gloss MUST NOT contain the lemma or any inflected form of the lemma';

export const SENSE_EQUIVALENT =
  'translateFieldsIn, when present, names the translation language. Then each sense MUST include "equivalent", the headword\'s equivalent in that language for this sense only: a word or short phrase a dictionary would list as the translation of the lemma. Use the gloss to choose the sense. Do not translate the gloss itself, and do not copy the gloss translation. Capitalize the first letter. When translateFieldsIn is absent, omit "equivalent".';

export const SENSE_EQUIVALENT_FIELD =
  'When translateFieldsIn is present, add "equivalent":"<headword equivalent in translateFieldsIn>" on each sense.';

export const SENSE_EXAMPLE = `Each sense MUST include "example", one sentence in the language named by writeFieldsIn. The sentence MUST include the lemma naturally and match that sense's gloss. Do not invent another sense. Write the sentence so the meaning of the lemma is obvious from the rest of the sentence. A learner who knows the other words should be able to tell what the lemma means immediately. Do not add citations. Keep the sentence at most ${MAX_EXAMPLE_LENGTH} characters. Spelling MUST be correct.`;

const EQUIVALENT_MAX_LENGTH = 200;

function elementFromSelectionSystemPrompt(
  fields: readonly AiMetadataField[],
  extra = false,
  contextual = false,
): string {
  return joinPrompt([
    'You add one dictionary element from a selected word or phrase.',
    'JSON keys stay in English.',
    'Every gloss MUST be in the language named by writeFieldsIn.',
    'Do not use English for a gloss unless writeFieldsIn is English.',
    metadataIntro(fields, extra),
    'Rules:',
    '- selected is written in writeFieldsIn. It is not written in translateFieldsIn',
    '- lemma is the citation form of selected in writeFieldsIn. When selected is already that form, lemma is selected. Do not translate selected into another language and do not choose a different word',
    ...(contextual
      ? [
          '- phraseKind is definition or example. phrase is that definition, or one example sentence, written in writeFieldsIn',
          '- selected is a word or phrase inside phrase. root, when present, is the headword that phrase defines or exemplifies. Define selected, not root',
          '- Return exactly one sense: the meaning of the lemma as selected is used in phrase',
          '- Do not return any other meaning',
        ]
      : [
          '- One sense per distinct meaning of that lemma',
          `- Return at most ${MAX_SENSES} senses`,
        ]),
    '- One short dictionary-style gloss per sense',
    NO_SELF_MENTION,
    '- Do not include forms',
    '- Do not add bracket tags such as [en:…]',
    '- Spelling MUST be correct in the lemma, every gloss, every example, and every translation',
    SENSE_EXAMPLE,
    ...metadataRuleLines('definition', fields, extra),
    SENSE_EQUIVALENT,
    'Return JSON only with this shape:',
    `{"lemma":"<root lemma>","senses":[${definitionSenseShape(fields, extra, true)}]}`,
    SENSE_EQUIVALENT_FIELD,
  ]);
}

function definitionFromExampleSystemPrompt(
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
    '- Spelling MUST be correct in the gloss',
    ...metadataRuleLines('definition', fields, extra),
    SENSE_EQUIVALENT,
    'A match does not include an equivalent.',
    'A new sense uses this shape:',
    `{"senses":[${definitionSenseShape(fields, extra)}]}`,
    SENSE_EQUIVALENT_FIELD,
  ]);
}

function metadataIntro(fields: readonly AiMetadataField[], extra = false): string {
  return fields.length || extra ? METADATA_VALUE_LANGUAGE_RULE : '';
}

function joinPrompt(lines: readonly string[]): string {
  return lines.filter((line) => line !== '').join('\n');
}

function formsSystemPrompt(fields: readonly AiMetadataField[], extra = false): string {
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

type GenerateDefinitionsInput = {
  language: string;
  title: string;
  existingDefinitions: ReadonlyArray<{
    text: string;
    metadata: ElementMetadata;
  }>;
  translation?: string;
};

type GenerateDefinitionFromExampleInput = GenerateDefinitionsInput & {
  example: string;
};

export type GeneratedDefinition = {
  text: string;
  metadata: ElementMetadata;
  /** Headword equivalent in the support language, when one was requested. */
  equivalent?: string;
  /** Example sentence for this sense, when one was requested. */
  example?: string;
};

type GenerateFormsInput = {
  language: string;
  title: string;
  gloss: string;
  existingForms: string[];
};

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
    describedDefinitions(input.existingDefinitions).map((definition) =>
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
    const equivalent = takenEquivalent(language, sense['equivalent'], input.translation ?? '');
    const example = takenExample(sense['example']);
    definitions.push({
      text: gloss,
      metadata: pickMetadata(
        sense['metadata'],
        metadataFieldKeys(readDefinitionMetadataFields()),
        readDefinitionExtraFields(),
      ),
      ...(equivalent ? { equivalent } : {}),
      ...(example ? { example } : {}),
    });
  }
  return definitions;
}

/** Fill a missing support-language equivalent. Senses that already have one stay as they are. */
export async function ensureSenseEquivalents(
  lemma: string,
  language: string,
  translation: string | undefined,
  senses: GeneratedDefinition[],
): Promise<GeneratedDefinition[]> {
  const target = translationTarget(language, translation);
  if (!target) return senses;
  return Promise.all(
    senses.map(async (sense) => {
      if (sense.equivalent?.trim()) return sense;
      const passage = parsePassage(sense.text);
      const definition = passage.text.trim();
      if (!definition) return sense;
      try {
        const equivalent = await generateEquivalent({
          lemma,
          sourceLang: language,
          definition,
          english: passage.translations.find((item) => item.language === target)?.text ?? '',
          targetLang: target,
        });
        const text = equivalent.trim().slice(0, EQUIVALENT_MAX_LENGTH);
        return text ? { ...sense, equivalent: text } : sense;
      } catch {
        return sense;
      }
    }),
  );
}

function buildDefinitionFromExampleUserMessage(input: GenerateDefinitionFromExampleInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, input.translation);
  return JSON.stringify({
    language,
    writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    lemma: input.title.trim(),
    example: input.example.trim().slice(0, MAX_EXAMPLE_LENGTH),
    existingDefinitions: describedDefinitions(input.existingDefinitions),
  });
}

/** Where one example sentence belongs: an existing sense, or a new one. */
type ExamplePlacement =
  { kind: 'existing'; gloss: string } | { kind: 'new'; definition: GeneratedDefinition };

function matchingGloss(gloss: string, existing: ReadonlyArray<{ gloss: string }>): string {
  const key = gloss.trim().toLowerCase();
  if (!key) return '';
  return existing.find((definition) => definition.gloss.toLowerCase() === key)?.gloss ?? '';
}

/** An existing sense for the example, a new sense, or null when the reply is unusable. */
function parseExamplePlacement(
  parsed: unknown,
  input: GenerateDefinitionFromExampleInput,
): ExamplePlacement | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const existing = describedDefinitions(input.existingDefinitions);
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
      readDefinitionMetadataFields(),
      readDefinitionExtraFields(),
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
    if (placed.kind === 'existing') return placed;
    const [definition] = await ensureSenseEquivalents(title, language, request.translation, [
      placed.definition,
    ]);
    return definition ? { kind: 'new', definition } : placed;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

type SelectionContext = {
  kind: 'definition' | 'example';
  phrase: string;
  root?: string;
};

type GenerateElementFromSelectionInput = {
  language: string;
  selected: string;
  translation?: string;
  /** The definition or example the selected word was taken from. */
  context?: SelectionContext;
};

type GeneratedElement = {
  lemma: string;
  definitions: GeneratedDefinition[];
};

function buildElementFromSelectionUserMessage(input: GenerateElementFromSelectionInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  const translateFieldsIn = translationLanguage(language, input.translation);
  const context = input.context;
  return JSON.stringify({
    language,
    writeFieldsIn,
    selectedIn: writeFieldsIn,
    ...(translateFieldsIn ? { translateFieldsIn } : {}),
    selected: input.selected.trim(),
    ...(context
      ? {
          phraseKind: context.kind,
          phrase: context.phrase,
          ...(context.root ? { root: context.root } : {}),
        }
      : {}),
  });
}

/** The root lemma and its senses, or null when the reply has neither. */
export async function generateElementFromSelection(
  request: GenerateElementFromSelectionInput,
): Promise<GeneratedElement | null> {
  const selected = request.selected.trim();
  const language = request.language.trim().toLowerCase();
  if (!selected || !language) return null;
  const { context: rawContext, ...rest } = request;
  const context = selectionContext(rawContext);
  const prepared: GenerateElementFromSelectionInput = {
    ...rest,
    selected,
    language,
    ...(context ? { context } : {}),
  };
  const input: CompleteJsonInput = {
    system: elementFromSelectionSystemPrompt(
      readDefinitionMetadataFields(),
      readDefinitionExtraFields(),
      !!prepared.context,
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
    return {
      lemma: element.lemma,
      definitions: await ensureSenseEquivalents(
        element.lemma,
        language,
        request.translation,
        element.definitions,
      ),
    };
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
  return { lemma, definitions: input.context ? definitions.slice(0, 1) : definitions };
}

function selectionContext(context: SelectionContext | undefined): SelectionContext | undefined {
  if (!context || (context.kind !== 'definition' && context.kind !== 'example')) return undefined;
  const phrase = context.phrase.replace(/\s+/g, ' ').trim();
  if (!phrase) return undefined;
  const root = context.root?.replace(/\s+/g, ' ').trim() ?? '';
  return { kind: context.kind, phrase, ...(root ? { root } : {}) };
}

function describedDefinitions(
  definitions: ReadonlyArray<{ text: string; metadata: ElementMetadata }>,
): Array<{ gloss: string; metadata?: ElementMetadata }> {
  const described: Array<{ gloss: string; metadata?: ElementMetadata }> = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const gloss = parsePassage(definition.text ?? '').text.trim();
    const key = gloss.toLowerCase();
    if (!gloss || seen.has(key)) continue;
    seen.add(key);
    const metadata = pickMetadata(
      definition.metadata,
      metadataFieldKeys(readDefinitionMetadataFields()),
      readDefinitionExtraFields(),
    );
    described.push({
      gloss,
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

function takenEquivalent(language: string, raw: unknown, translation: string): string {
  if (!translationLanguage(language, translation)) return '';
  const text = plainText(raw).replace(/]/g, '').replace(/\s+/g, ' ').trim();
  const capitalized = text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('en'));
  return capitalized.slice(0, EQUIVALENT_MAX_LENGTH);
}

/** The example sentence, or empty when it is missing or too long. */
function takenExample(raw: unknown): string {
  const sentence = parsePassage(plainText(raw)).text.replace(/\s+/g, ' ').trim();
  if (!sentence || sentence.length > MAX_EXAMPLE_LENGTH) return '';
  return sentence;
}

function buildFormsUserMessage(input: GenerateFormsInput): string {
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
function parseGeneratedForms(parsed: unknown, input: GenerateFormsInput): ElementForm[] | null {
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
    system: formsSystemPrompt(readFormMetadataFields(), readFormExtraFields()),
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
        ? pickMetadata(
            (item as { metadata?: unknown }).metadata,
            metadataFieldKeys(readFormMetadataFields()),
            readFormExtraFields(),
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
