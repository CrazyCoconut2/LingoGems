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
      'the country or region this sense belongs to, written in writeFieldsIn. Omit it when the sense is not specific to a place',
  },
  {
    key: 'semantic domain',
    prompt:
      'the subject area of this sense, written in writeFieldsIn. Omit it when the sense is not tied to one area',
  },
];

export const DEFAULT_EXAMPLE_METADATA_FIELDS: readonly AiMetadataField[] = [];

type StoredLanguageSettings = {
  definitions?: AiMetadataField[];
  examples?: AiMetadataField[];
  definitionTranslations?: false;
  exampleTranslations?: false;
  definitionExtraFields?: true;
  exampleExtraFields?: true;
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

/** Off unless this language has asked for fields beyond the configured list. */
export function readDefinitionExtraFields(language: string): boolean {
  return readEntry(language)?.definitionExtraFields === true;
}

export function readExampleExtraFields(language: string): boolean {
  return readEntry(language)?.exampleExtraFields === true;
}

export function writeDefinitionExtraFields(language: string, enabled: boolean): void {
  updateLanguage(language, (entry) => {
    if (enabled) entry.definitionExtraFields = true;
    else delete entry.definitionExtraFields;
  });
}

export function writeExampleExtraFields(language: string, enabled: boolean): void {
  updateLanguage(language, (entry) => {
    if (enabled) entry.exampleExtraFields = true;
    else delete entry.exampleExtraFields;
  });
}

/** Metadata values are written in the language being learned. Keys stay the English names. */
export const METADATA_VALUE_LANGUAGE_RULE =
  'Every metadata value MUST be in the language named by writeFieldsIn. Do not use English for a metadata value unless writeFieldsIn is English. Metadata keys stay in English. A note that explains a field is not a sample answer to copy.';

/** Rule lines for a system prompt, or none when no fields are configured and extras are off. */
export function metadataRuleLines(
  kind: 'definition' | 'example',
  fields: readonly AiMetadataField[],
  extra = false,
): string[] {
  if (!fields.length && !extra) return [];
  const label = kind === 'definition' ? 'Definition' : 'Example';
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
    if (
      !key ||
      key.includes('<') ||
      key.includes('>') ||
      seen.has(id) ||
      id === 'frequency' ||
      id === 'gem'
    ) {
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
  const body = fields
    .map((field) => `${JSON.stringify(field.key)}:"<in writeFieldsIn>"`)
    .join(',');
  const pairs = [body, extra ? '"<other relevant key>":"<in writeFieldsIn>"' : ''].filter(Boolean).join(',');
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
        definitionExtraFields?: unknown;
        exampleExtraFields?: unknown;
      };
      const entry: StoredLanguageSettings = {};
      if (Array.isArray(record.definitions)) entry.definitions = readFieldList(record.definitions);
      if (Array.isArray(record.examples)) entry.examples = readFieldList(record.examples);
      if (record.definitionTranslations === false) entry.definitionTranslations = false;
      if (record.exampleTranslations === false) entry.exampleTranslations = false;
      if (record.definitionExtraFields === true) entry.definitionExtraFields = true;
      if (record.exampleExtraFields === true) entry.exampleExtraFields = true;
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
    if (entry.definitionExtraFields === true) next.definitionExtraFields = true;
    if (entry.exampleExtraFields === true) next.exampleExtraFields = true;
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

