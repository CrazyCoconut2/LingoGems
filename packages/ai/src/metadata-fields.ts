import type { ElementMetadata } from 'collection';

export const MAX_METADATA_FIELDS = 12;
export const MAX_METADATA_FIELD_KEY = 40;
export const MAX_METADATA_FIELD_PROMPT = 400;
const MAX_METADATA_VALUE_LENGTH = 100;

const LANGUAGE_SETTINGS_KEY = 'lingogem.ai-language-settings.v1';
const LEGACY_METADATA_FIELDS_KEY = 'lingogem.ai-metadata-fields.v1';
const LEGACY_TRANSLATIONS_KEY = 'lingogem.ai-generate-translations.v1';

export type AiMetadataField = {
  key: string;
  prompt: string;
};

export const DEFAULT_DEFINITION_METADATA_FIELDS: readonly AiMetadataField[] = [
  { key: 'part of speech', prompt: '' },
  { key: 'gender', prompt: '' },
  { key: 'transitivity', prompt: '' },
  { key: 'register', prompt: '' },
  {
    key: 'region',
    prompt:
      'the country or region this sense belongs to. Omit it when the sense is not specific to a place',
  },
  {
    key: 'semantic domain',
    prompt:
      'the subject area of this sense, such as food, law, or kinship. Omit it when the sense is not tied to one area',
  },
];

export const DEFAULT_EXAMPLE_METADATA_FIELDS: readonly AiMetadataField[] = [];

type StoredLanguageSettings = {
  definitions?: AiMetadataField[];
  examples?: AiMetadataField[];
  definitionTranslations?: false;
  exampleTranslations?: false;
};

type LanguageSettingsMap = Record<string, StoredLanguageSettings>;

type LegacyMetadataFields = {
  definitions: AiMetadataField[] | null;
  examples: AiMetadataField[] | null;
};

type LegacyTranslations = {
  definitions: boolean;
  examples: boolean;
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
export function metadataFieldsMatch(
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

export function readDefinitionMetadataFields(language: string): AiMetadataField[] {
  return copyFields(fieldsFor(language, 'definitions', DEFAULT_DEFINITION_METADATA_FIELDS));
}

export function readExampleMetadataFields(language: string): AiMetadataField[] {
  return copyFields(fieldsFor(language, 'examples', DEFAULT_EXAMPLE_METADATA_FIELDS));
}

/** An empty list is stored. A list that matches the default is cleared. */
export function writeDefinitionMetadataFields(
  language: string,
  fields: readonly AiMetadataField[],
): void {
  const normalized = normalizeMetadataFields(fields);
  updateLanguage(language, (entry) => {
    if (metadataFieldsMatch(normalized, DEFAULT_DEFINITION_METADATA_FIELDS)) delete entry.definitions;
    else entry.definitions = normalized;
  });
}

export function writeExampleMetadataFields(
  language: string,
  fields: readonly AiMetadataField[],
): void {
  const normalized = normalizeMetadataFields(fields);
  updateLanguage(language, (entry) => {
    if (metadataFieldsMatch(normalized, DEFAULT_EXAMPLE_METADATA_FIELDS)) delete entry.examples;
    else entry.examples = normalized;
  });
}

export function resetDefinitionMetadataFields(language: string): void {
  updateLanguage(language, (entry) => {
    delete entry.definitions;
  });
}

export function resetExampleMetadataFields(language: string): void {
  updateLanguage(language, (entry) => {
    delete entry.examples;
  });
}

export function readDefinitionTranslations(language: string): boolean {
  return translationsFor(language).definitions;
}

export function readExampleTranslations(language: string): boolean {
  return translationsFor(language).examples;
}

export function writeDefinitionTranslations(language: string, enabled: boolean): void {
  updateLanguage(language, (entry) => {
    if (enabled) delete entry.definitionTranslations;
    else entry.definitionTranslations = false;
  });
}

export function writeExampleTranslations(language: string, enabled: boolean): void {
  updateLanguage(language, (entry) => {
    if (enabled) delete entry.exampleTranslations;
    else entry.exampleTranslations = false;
  });
}

/** Rule lines for a system prompt, or none when no fields are configured. */
export function metadataRuleLines(
  kind: 'definition' | 'example',
  fields: readonly AiMetadataField[],
): string[] {
  if (!fields.length) return [];
  const label = kind === 'definition' ? 'Definition' : 'Example';
  const lines = [
    `- metadata is key-value pairs that apply to that ${kind}. Omit a pair when it does not apply`,
    `- ${label} metadata keys are only ${quotedKeyList(fields)}`,
  ];
  for (const field of fields) {
    const quoted = JSON.stringify(field.key);
    lines.push(field.prompt ? `- ${quoted}: ${field.prompt}` : `- ${quoted}`);
  }
  return lines;
}

export function definitionSenseShape(fields: readonly AiMetadataField[]): string {
  const meta = metadataSuffix(fields);
  const rest = meta === '}' ? '}' : `${meta.slice(0, -1)}}`;
  return `{"gloss":"<definition in writeFieldsIn>","frequency":"<common|uncommon|rare|archaic|obsolete>"${rest}`;
}

export function exampleSentenceShape(fields: readonly AiMetadataField[]): string {
  return `{"text":"<sentence>"${metadataSuffix(fields)}}`;
}

/** Keep values for the configured keys. A note does not limit which strings are kept. */
export function pickMetadata(value: unknown, keys: readonly string[]): ElementMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue;
    const canonical = keys.find((key) => key.toLowerCase() === rawKey.trim().toLowerCase());
    if (!canonical) continue;
    const text = rawValue.trim().slice(0, MAX_METADATA_VALUE_LENGTH);
    if (!text) continue;
    metadata[canonical.slice(0, MAX_METADATA_FIELD_KEY)] = text;
  }
  return metadata;
}

function metadataSuffix(fields: readonly AiMetadataField[]): string {
  if (!fields.length) return '}';
  const body = fields
    .map((field) => `${JSON.stringify(field.key)}:${JSON.stringify(`<${field.key}>`)}`)
    .join(',');
  return `,"metadata":{${body}}}`;
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
  language: string,
  kind: 'definitions' | 'examples',
  defaults: readonly AiMetadataField[],
): readonly AiMetadataField[] {
  const entry = readEntry(language);
  if (entry) return entry[kind] ?? defaults;
  const legacy = readLegacyFields();
  return (kind === 'definitions' ? legacy.definitions : legacy.examples) ?? defaults;
}

function translationsFor(language: string): LegacyTranslations {
  const entry = readEntry(language);
  if (entry) {
    return {
      definitions: entry.definitionTranslations !== false,
      examples: entry.exampleTranslations !== false,
    };
  }
  return readLegacyTranslations();
}

function readEntry(language: string): StoredLanguageSettings | null {
  const code = languageCode(language);
  if (!code) return null;
  const map = readMap();
  return Object.prototype.hasOwnProperty.call(map, code) ? map[code] : null;
}

function updateLanguage(
  language: string,
  change: (entry: StoredLanguageSettings) => void,
): void {
  const code = languageCode(language);
  if (!code || typeof localStorage === 'undefined') return;
  const map = readMap();
  if (!Object.prototype.hasOwnProperty.call(map, code)) map[code] = entryFromLegacy();
  change(map[code]);
  writeMap(map);
}

function entryFromLegacy(): StoredLanguageSettings {
  const fields = readLegacyFields();
  const translations = readLegacyTranslations();
  const entry: StoredLanguageSettings = {};
  if (fields.definitions !== null) entry.definitions = copyFields(fields.definitions);
  if (fields.examples !== null) entry.examples = copyFields(fields.examples);
  if (!translations.definitions) entry.definitionTranslations = false;
  if (!translations.examples) entry.exampleTranslations = false;
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
      if (!language || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as {
        definitions?: unknown;
        examples?: unknown;
        definitionTranslations?: unknown;
        exampleTranslations?: unknown;
      };
      const entry: StoredLanguageSettings = {};
      if (Array.isArray(record.definitions)) entry.definitions = readFieldList(record.definitions);
      if (Array.isArray(record.examples)) entry.examples = readFieldList(record.examples);
      if (record.definitionTranslations === false) entry.definitionTranslations = false;
      if (record.exampleTranslations === false) entry.exampleTranslations = false;
      map[language] = entry;
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: LanguageSettingsMap): void {
  if (typeof localStorage === 'undefined') return;
  const stored: LanguageSettingsMap = {};
  for (const [code, entry] of Object.entries(map)) {
    const next: StoredLanguageSettings = {};
    if (entry.definitions !== undefined) next.definitions = entry.definitions;
    if (entry.examples !== undefined) next.examples = entry.examples;
    if (entry.definitionTranslations === false) next.definitionTranslations = false;
    if (entry.exampleTranslations === false) next.exampleTranslations = false;
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

function readLegacyTranslations(): LegacyTranslations {
  if (typeof localStorage === 'undefined') return { definitions: true, examples: true };
  try {
    const raw = localStorage.getItem(LEGACY_TRANSLATIONS_KEY);
    if (!raw) return { definitions: true, examples: true };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { definitions: true, examples: true };
    }
    const record = parsed as { definitions?: unknown; examples?: unknown };
    return {
      definitions: record.definitions !== false,
      examples: record.examples !== false,
    };
  } catch {
    return { definitions: true, examples: true };
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

