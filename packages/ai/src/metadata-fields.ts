import type { ElementMetadata } from 'collection';

export const MAX_METADATA_FIELDS = 12;
export const MAX_METADATA_FIELD_KEY = 40;
export const MAX_METADATA_FIELD_PROMPT = 400;
const MAX_METADATA_VALUE_LENGTH = 100;

const AI_METADATA_FIELDS_KEY = 'lingogem.ai-metadata-fields.v1';

export type AiMetadataField = {
  key: string;
  prompt: string;
};

export const DEFAULT_DEFINITION_METADATA_FIELDS: readonly AiMetadataField[] = [
  { key: 'part of speech', prompt: '' },
  { key: 'gender', prompt: '' },
  { key: 'transitivity', prompt: '' },
  { key: 'register', prompt: '' },
];

export const DEFAULT_EXAMPLE_METADATA_FIELDS: readonly AiMetadataField[] = [];

type StoredMetadataFields = {
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

export function readDefinitionMetadataFields(): AiMetadataField[] {
  return copyFields(readStored().definitions ?? DEFAULT_DEFINITION_METADATA_FIELDS);
}

export function readExampleMetadataFields(): AiMetadataField[] {
  return copyFields(readStored().examples ?? DEFAULT_EXAMPLE_METADATA_FIELDS);
}

/** An empty list is stored. A list that matches the default is cleared. */
export function writeDefinitionMetadataFields(fields: readonly AiMetadataField[]): void {
  const current = readStored();
  const normalized = normalizeMetadataFields(fields);
  current.definitions = metadataFieldsMatch(normalized, DEFAULT_DEFINITION_METADATA_FIELDS)
    ? null
    : normalized;
  persist(current);
}

export function writeExampleMetadataFields(fields: readonly AiMetadataField[]): void {
  const current = readStored();
  const normalized = normalizeMetadataFields(fields);
  current.examples = metadataFieldsMatch(normalized, DEFAULT_EXAMPLE_METADATA_FIELDS)
    ? null
    : normalized;
  persist(current);
}

export function resetDefinitionMetadataFields(): void {
  const current = readStored();
  current.definitions = null;
  persist(current);
}

export function resetExampleMetadataFields(): void {
  const current = readStored();
  current.examples = null;
  persist(current);
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
  return `{"gloss":"<definition in writeFieldsIn>"${metadataSuffix(fields)}}`;
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

function readStored(): StoredMetadataFields {
  if (typeof localStorage === 'undefined') return { definitions: null, examples: null };
  try {
    const raw = localStorage.getItem(AI_METADATA_FIELDS_KEY);
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

function persist(state: StoredMetadataFields): void {
  if (typeof localStorage === 'undefined') return;
  const stored: { definitions?: AiMetadataField[]; examples?: AiMetadataField[] } = {};
  if (state.definitions !== null) stored.definitions = state.definitions;
  if (state.examples !== null) stored.examples = state.examples;
  if (!Object.keys(stored).length) localStorage.removeItem(AI_METADATA_FIELDS_KEY);
  else localStorage.setItem(AI_METADATA_FIELDS_KEY, JSON.stringify(stored));
}
