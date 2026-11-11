import { isLearnableLanguage, type ElementMetadata } from 'collection';

export const MAX_METADATA_FIELDS = 12;
export const MAX_METADATA_FIELD_KEY = 40;
export const MAX_METADATA_FIELD_PROMPT = 400;
const MAX_METADATA_VALUE_LENGTH = 100;

const LANGUAGE_SETTINGS_KEY = 'lingogem.ai-language-settings.v1';
const GLOBAL_SETTINGS_KEY = 'app';
const LEGACY_METADATA_FIELDS_KEY = 'lingogem.ai-metadata-fields.v1';

export type AiMetadataField = {
  key: string;
  prompt: string;
};

export const DEFAULT_DEFINITION_METADATA_FIELDS: readonly AiMetadataField[] = [
  { key: 'part of speech', prompt: '' },
  { key: 'transitivity', prompt: '' },
  { key: 'register', prompt: '' },
  {
    key: 'region',
    prompt:
      'the country or region this sense belongs to, written in writeFieldsIn. Omit it when the sense is not specific to a place',
  },
  {
    key: 'semantic domain',
    prompt:
      'the subject area of this sense, written in writeFieldsIn. Omit it when the sense is not tied to one area',
  },
];

export const DEFAULT_EXAMPLE_METADATA_FIELDS: readonly AiMetadataField[] = [];

export const DEFAULT_FORM_METADATA_FIELDS: readonly AiMetadataField[] = [
  { key: 'tense', prompt: '' },
  { key: 'person', prompt: '' },
  { key: 'number', prompt: '' },
  { key: 'mood', prompt: '' },
];

type StoredLanguageSettings = {
  definitions?: AiMetadataField[];
  examples?: AiMetadataField[];
  forms?: AiMetadataField[];
  definitionExtraFields?: true;
  exampleExtraFields?: true;
  formExtraFields?: true;
};

type LanguageSettingsMap = Record<string, StoredLanguageSettings>;

type LegacyMetadataFields = {
  definitions: AiMetadataField[] | null;
  examples: AiMetadataField[] | null;
};

/** Trim, cap, and drop empty or repeated keys. The first spelling of a key wins. */
export function normalizeMetadataFields(fields: readonly AiMetadataField[]): AiMetadataField[] {
  const seen = new Set<string>();
  const next: AiMetadataField[] = [];
  for (const field of fields) {
    const key = field.key.replace(/\s+/g, ' ').trim().slice(0, MAX_METADATA_FIELD_KEY);
    if (!key) continue;
    const id = key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({
      key,
      prompt: field.prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_METADATA_FIELD_PROMPT),
    });
    if (next.length >= MAX_METADATA_FIELDS) break;
  }
  return next;
}

/** True when the saved list is the same as the default, ignoring blank rows. */
function metadataFieldsMatch(
  fields: readonly AiMetadataField[],
  defaults: readonly AiMetadataField[],
): boolean {
  const left = normalizeMetadataFields(fields);
  if (left.length !== defaults.length) return false;
  return left.every(
    (field, index) =>
      field.key === defaults[index]?.key && field.prompt === defaults[index]?.prompt,
  );
}

export function metadataFieldKeys(fields: readonly AiMetadataField[]): string[] {
  return fields.map((field) => field.key);
}

export function readDefinitionMetadataFields(): AiMetadataField[] {
  return copyFields(fieldsFor('definitions', DEFAULT_DEFINITION_METADATA_FIELDS));
}

export function readExampleMetadataFields(): AiMetadataField[] {
  return copyFields(fieldsFor('examples', DEFAULT_EXAMPLE_METADATA_FIELDS));
}

export function readFormMetadataFields(): AiMetadataField[] {
  return copyFields(fieldsFor('forms', DEFAULT_FORM_METADATA_FIELDS));
}

/** An empty list is stored. A list that matches the default is cleared. */
export function writeDefinitionMetadataFields(fields: readonly AiMetadataField[]): void {
  const normalized = normalizeMetadataFields(fields);
  updateSettings((entry) => {
    if (metadataFieldsMatch(normalized, DEFAULT_DEFINITION_METADATA_FIELDS))
      delete entry.definitions;
    else entry.definitions = normalized;
  });
}

export function writeExampleMetadataFields(fields: readonly AiMetadataField[]): void {
  const normalized = normalizeMetadataFields(fields);
  updateSettings((entry) => {
    if (metadataFieldsMatch(normalized, DEFAULT_EXAMPLE_METADATA_FIELDS)) delete entry.examples;
    else entry.examples = normalized;
  });
}

export function writeFormMetadataFields(fields: readonly AiMetadataField[]): void {
  const normalized = normalizeMetadataFields(fields);
  updateSettings((entry) => {
    if (metadataFieldsMatch(normalized, DEFAULT_FORM_METADATA_FIELDS)) delete entry.forms;
    else entry.forms = normalized;
  });
}

export function resetDefinitionMetadataFields(): void {
  updateSettings((entry) => {
    delete entry.definitions;
  });
}

export function resetExampleMetadataFields(): void {
  updateSettings((entry) => {
    delete entry.examples;
  });
}

export function resetFormMetadataFields(): void {
  updateSettings((entry) => {
    delete entry.forms;
  });
}

/** Off unless extra fields beyond the configured list are enabled. */
export function readDefinitionExtraFields(): boolean {
  return readEntry()?.definitionExtraFields === true;
}

export function readExampleExtraFields(): boolean {
  return readEntry()?.exampleExtraFields === true;
}

export function readFormExtraFields(): boolean {
  return readEntry()?.formExtraFields === true;
}

export function writeDefinitionExtraFields(enabled: boolean): void {
  updateSettings((entry) => {
    if (enabled) entry.definitionExtraFields = true;
    else delete entry.definitionExtraFields;
  });
}

export function writeExampleExtraFields(enabled: boolean): void {
  updateSettings((entry) => {
    if (enabled) entry.exampleExtraFields = true;
    else delete entry.exampleExtraFields;
  });
}

export function writeFormExtraFields(enabled: boolean): void {
  updateSettings((entry) => {
    if (enabled) entry.formExtraFields = true;
    else delete entry.formExtraFields;
  });
}

/** Metadata values are written in the language being learned. Keys stay the English names. */
export const METADATA_VALUE_LANGUAGE_RULE =
  'Every metadata value MUST be in the language named by writeFieldsIn. Do not use English for a metadata value unless writeFieldsIn is English. Metadata keys stay in English. A note that explains a field is not a sample answer to copy.';

/** Rule lines for a system prompt, or none when no fields are configured and extras are off. */
export function metadataRuleLines(
  kind: 'definition' | 'example' | 'form',
  fields: readonly AiMetadataField[],
  extra = false,
): string[] {
  if (!fields.length && !extra) return [];
  const label = kind === 'definition' ? 'Definition' : kind === 'example' ? 'Example' : 'Form';
  const lines = [
    `- metadata is key-value pairs that apply to that ${kind}. Omit a pair when it does not apply`,
    `- ${METADATA_VALUE_LANGUAGE_RULE}`,
  ];
  if (fields.length && extra) {
    lines.push(
      `- Include ${quotedKeyList(fields)} when they apply`,
      '- You may add other metadata keys when a further field is relevant. Each extra key is a short English name, and its value is in writeFieldsIn. Do not copy a placeholder key. Omit a field that is not relevant',
    );
  } else if (fields.length) {
    lines.push(`- ${label} metadata keys are only ${quotedKeyList(fields)}`);
  } else {
    lines.push(
      `- Add metadata only when a field is relevant to that ${kind}. Each key is a short English name, and its value is in writeFieldsIn. Do not copy a placeholder key. Omit metadata when nothing further is relevant`,
    );
  }
  for (const field of fields) {
    const quoted = JSON.stringify(field.key);
    lines.push(field.prompt ? `- ${quoted}: ${field.prompt}` : `- ${quoted}`);
  }
  return lines;
}

export function definitionSenseShape(fields: readonly AiMetadataField[], extra = false): string {
  const meta = metadataSuffix(fields, extra);
  const rest = meta === '}' ? '}' : `${meta.slice(0, -1)}}`;
  return `{"gloss":"<definition in writeFieldsIn>"${rest}`;
}

export function exampleSentenceShape(fields: readonly AiMetadataField[], extra = false): string {
  return `{"text":"<sentence>"${metadataSuffix(fields, extra)}`;
}

export function formEntryShape(fields: readonly AiMetadataField[], extra = false): string {
  return `{"text":"<inflected lemma only>"${metadataSuffix(fields, extra)}`;
}

/** Keep values for the configured keys. When extra is set, also keep other relevant keys. */
export function pickMetadata(
  value: unknown,
  keys: readonly string[],
  extra = false,
): ElementMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata: ElementMetadata = {};
  const seen = new Set<string>();
  const entries = Object.entries(value);
  for (const [rawKey, rawValue] of entries) {
    if (typeof rawValue !== 'string') continue;
    const canonical = keys.find((key) => key.toLowerCase() === rawKey.trim().toLowerCase());
    if (!canonical) continue;
    seen.add(canonical.toLowerCase());
    const text = rawValue.trim().slice(0, MAX_METADATA_VALUE_LENGTH);
    if (!text) continue;
    metadata[canonical.slice(0, MAX_METADATA_FIELD_KEY)] = text;
  }
  if (!extra) return metadata;
  for (const [rawKey, rawValue] of entries) {
    if (Object.keys(metadata).length >= MAX_METADATA_FIELDS) break;
    if (typeof rawValue !== 'string') continue;
    const key = rawKey.replace(/\s+/g, ' ').trim().slice(0, MAX_METADATA_FIELD_KEY);
    const id = key.toLowerCase();
    if (!key || key.includes('<') || key.includes('>') || seen.has(id) || id === 'frequency') {
      continue;
    }
    if (keys.some((item) => item.toLowerCase() === id)) continue;
    seen.add(id);
    const text = rawValue.trim().slice(0, MAX_METADATA_VALUE_LENGTH);
    if (!text) continue;
    metadata[key] = text;
  }
  return metadata;
}

function metadataSuffix(fields: readonly AiMetadataField[], extra = false): string {
  if (!fields.length && !extra) return '}';
  const body = fields.map((field) => `${JSON.stringify(field.key)}:"<in writeFieldsIn>"`).join(',');
  const pairs = [body, extra ? '"<other relevant key>":"<in writeFieldsIn>"' : '']
    .filter(Boolean)
    .join(',');
  return `,"metadata":{${pairs}}}`;
}

function quotedKeyList(fields: readonly AiMetadataField[]): string {
  const keys = fields.map((field) => JSON.stringify(field.key));
  if (keys.length <= 1) return keys[0] ?? '';
  if (keys.length === 2) return `${keys[0]} and ${keys[1]}`;
  return `${keys.slice(0, -1).join(', ')}, and ${keys[keys.length - 1]}`;
}

function copyFields(fields: readonly AiMetadataField[]): AiMetadataField[] {
  return fields.map((field) => ({ key: field.key, prompt: field.prompt }));
}

function languageCode(language: string): string {
  return language.trim().toLowerCase();
}

function fieldsFor(
  kind: 'definitions' | 'examples' | 'forms',
  defaults: readonly AiMetadataField[],
): readonly AiMetadataField[] {
  const entry = readEntry();
  if (entry) return entry[kind] ?? defaults;
  if (kind === 'forms') return defaults;
  const legacy = readLegacyFields();
  return (kind === 'definitions' ? legacy.definitions : legacy.examples) ?? defaults;
}

function readEntry(): StoredLanguageSettings | null {
  const map = readMap();
  return map[GLOBAL_SETTINGS_KEY] ?? null;
}

function updateSettings(change: (entry: StoredLanguageSettings) => void): void {
  if (typeof localStorage === 'undefined') return;
  const map = readMap();
  const entry = map[GLOBAL_SETTINGS_KEY] ?? entryFromLegacy();
  change(entry);
  writeMap({ [GLOBAL_SETTINGS_KEY]: entry });
}

function entryFromLegacy(): StoredLanguageSettings {
  const fields = readLegacyFields();
  const entry: StoredLanguageSettings = {};
  if (fields.definitions !== null) entry.definitions = copyFields(fields.definitions);
  if (fields.examples !== null) entry.examples = copyFields(fields.examples);
  return entry;
}

function readMap(): LanguageSettingsMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LANGUAGE_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: LanguageSettingsMap = {};
    for (const [code, value] of Object.entries(parsed)) {
      const language = languageCode(code);
      if (
        !language ||
        (language !== GLOBAL_SETTINGS_KEY && !isLearnableLanguage(language)) ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        continue;
      }
      const record = value as {
        definitions?: unknown;
        examples?: unknown;
        forms?: unknown;
        definitionExtraFields?: unknown;
        exampleExtraFields?: unknown;
        formExtraFields?: unknown;
      };
      const entry: StoredLanguageSettings = {};
      if (Array.isArray(record.definitions)) entry.definitions = readFieldList(record.definitions);
      if (Array.isArray(record.examples)) entry.examples = readFieldList(record.examples);
      if (Array.isArray(record.forms)) entry.forms = readFieldList(record.forms);
      if (record.definitionExtraFields === true) entry.definitionExtraFields = true;
      if (record.exampleExtraFields === true) entry.exampleExtraFields = true;
      if (record.formExtraFields === true) entry.formExtraFields = true;
      map[language] = entry;
    }
    return collapseToGlobal(map);
  } catch {
    return {};
  }
}

function collapseToGlobal(map: LanguageSettingsMap): LanguageSettingsMap {
  const languages = Object.entries(map).filter(([code]) => isLearnableLanguage(code));
  if (!languages.length)
    return map[GLOBAL_SETTINGS_KEY] ? { [GLOBAL_SETTINGS_KEY]: map[GLOBAL_SETTINGS_KEY] } : {};
  const merged = mergeSettings([
    ...(map[GLOBAL_SETTINGS_KEY] ? [map[GLOBAL_SETTINGS_KEY]] : []),
    ...languages.map(([, entry]) => entry),
  ]);
  const next = { [GLOBAL_SETTINGS_KEY]: merged };
  writeMap(next);
  return next;
}

function mergeSettings(entries: readonly StoredLanguageSettings[]): StoredLanguageSettings {
  const merged: StoredLanguageSettings = {};
  const definitions: AiMetadataField[] = [];
  const examples: AiMetadataField[] = [];
  const forms: AiMetadataField[] = [];
  let sawDefinitions = false;
  let sawExamples = false;
  let sawForms = false;
  for (const entry of entries) {
    if (entry.definitions) {
      sawDefinitions = true;
      definitions.push(...entry.definitions);
    }
    if (entry.examples) {
      sawExamples = true;
      examples.push(...entry.examples);
    }
    if (entry.forms) {
      sawForms = true;
      forms.push(...entry.forms);
    }
    if (entry.definitionExtraFields) merged.definitionExtraFields = true;
    if (entry.exampleExtraFields) merged.exampleExtraFields = true;
    if (entry.formExtraFields) merged.formExtraFields = true;
  }
  if (sawDefinitions) merged.definitions = normalizeMetadataFields(definitions);
  if (sawExamples) merged.examples = normalizeMetadataFields(examples);
  if (sawForms) merged.forms = normalizeMetadataFields(forms);
  return merged;
}

function writeMap(map: LanguageSettingsMap): void {
  if (typeof localStorage === 'undefined') return;
  const stored: LanguageSettingsMap = {};
  for (const [code, entry] of Object.entries(map)) {
    const next: StoredLanguageSettings = {};
    if (entry.definitions !== undefined) next.definitions = entry.definitions;
    if (entry.examples !== undefined) next.examples = entry.examples;
    if (entry.forms !== undefined) next.forms = entry.forms;
    if (entry.definitionExtraFields === true) next.definitionExtraFields = true;
    if (entry.exampleExtraFields === true) next.exampleExtraFields = true;
    if (entry.formExtraFields === true) next.formExtraFields = true;
    stored[code] = next;
  }
  if (!Object.keys(stored).length) localStorage.removeItem(LANGUAGE_SETTINGS_KEY);
  else localStorage.setItem(LANGUAGE_SETTINGS_KEY, JSON.stringify(stored));
}

function readLegacyFields(): LegacyMetadataFields {
  if (typeof localStorage === 'undefined') return { definitions: null, examples: null };
  try {
    const raw = localStorage.getItem(LEGACY_METADATA_FIELDS_KEY);
    if (!raw) return { definitions: null, examples: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { definitions: null, examples: null };
    }
    const record = parsed as { definitions?: unknown; examples?: unknown };
    return {
      definitions: Array.isArray(record.definitions) ? readFieldList(record.definitions) : null,
      examples: Array.isArray(record.examples) ? readFieldList(record.examples) : null,
    };
  } catch {
    return { definitions: null, examples: null };
  }
}

function readFieldList(raw: unknown[]): AiMetadataField[] {
  const fields: AiMetadataField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as { key?: unknown; prompt?: unknown };
    fields.push({
      key: typeof record.key === 'string' ? record.key : '',
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
    });
  }
  return normalizeMetadataFields(fields);
}
