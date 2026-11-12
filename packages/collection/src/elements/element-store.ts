import { ELEMENTS_STORE, idbRequest, openDatabase } from '../database';
import {
  isLearnableLanguage,
  languageCodeFromLabel,
  type LearnableLanguage,
} from '../languages/catalog';
import { mergeMetadataCatalog } from './metadata-catalog';
import {
  collectMetadataIndexes,
  emptyMetadataIndexes,
  metadataIndexesEmpty,
  type ElementMetadataVariability,
} from './metadata-variability';

export type ElementMetadata = Record<string, string>;

type ElementExample = {
  text: string;
  metadata: ElementMetadata;
};

export type ElementEquivalent = {
  id: string;
  text: string;
};

export type ElementForm = {
  text: string;
  metadata: ElementMetadata;
};

/** Highest gem score one translation answer can earn. */
export const TRANSLATION_GEM_MAX = 5;

export type DefinitionLogBy = 'user' | 'ai';

export type DefinitionGame = 'translation' | 'example' | 'definition';

/** A scored answer. `game` through `explanation` is the metadata for that answer. */
export type DefinitionGameLog = {
  event: 'game';
  game: DefinitionGame;
  gems: number;
  by: DefinitionLogBy;
  at: number;
  answer: string;
  explanation?: string;
};

/** One interaction on a definition: a scored game, a rework, or a reveal. */
export type DefinitionLogEntry =
  DefinitionGameLog | { event: 'rework'; at: number } | { event: 'reveal'; at: number };

/** A comfort change or an open. `at` is when it happened. */
export type ElementLogEntry =
  { event: 'comfort'; comfort: number; at: number } | { event: 'click'; at: number };

export type ElementDefinition = {
  text: string;
  equivalentId: string | null;
  forms: ElementForm[];
  examples: ElementExample[];
  metadata: ElementMetadata;
  log: DefinitionLogEntry[];
};

/** The strings a form list is matched and highlighted with. */
export function formTexts(forms: readonly ElementForm[]): string[] {
  return forms.map((form) => form.text);
}

/** 1 is Translation, 2 is Example, and 3 is Definition. */
export type ElementMode = 1 | 2 | 3;

const ELEMENT_MODE_LABELS: Record<ElementMode, string> = {
  1: 'Translation',
  2: 'Example',
  3: 'Definition',
};

export function elementModeLabel(mode: ElementMode): string {
  return ELEMENT_MODE_LABELS[mode];
}

const MIN_COMFORT = 1;
const MAX_COMFORT = 10;

export type StoredElement = {
  id: string;
  language: LearnableLanguage;
  title: string;
  equivalents: ElementEquivalent[];
  definitions: ElementDefinition[];
  /** Unset until the user chooses a mode. */
  mode: ElementMode | null;
  /** How comfortable this element feels, from 1 to 10. Missing values are 1. */
  comfort: number;
  /** Times this card was opened from the edition list. Missing values are 0. */
  clicks: number;
  /** Dated comfort changes and opens. Missing values are an empty log. */
  log: ElementLogEntry[];
  /** Distinct metadata values across this element's definitions. */
  definitionMetadata: ElementMetadataVariability;
  /** Distinct metadata values across this element's examples. */
  exampleMetadata: ElementMetadataVariability;
  /** Distinct metadata values across this element's forms. */
  formMetadata: ElementMetadataVariability;
  createdAt: number;
  /** Set when the element was removed from the collection. The record stays. */
  deletedAt: number | null;
};

/** Empty text clears the link. An exact text match reuses that equivalent. */
export function assignEquivalent(
  equivalents: readonly ElementEquivalent[],
  draft: string,
): { equivalents: ElementEquivalent[]; equivalentId: string | null } {
  const text = draft.trim();
  if (!text) return { equivalents: [...equivalents], equivalentId: null };
  const existing = equivalents.find((item) => item.text === text);
  if (existing) return { equivalents: [...equivalents], equivalentId: existing.id };
  const created: ElementEquivalent = { id: crypto.randomUUID(), text };
  return { equivalents: [...equivalents, created], equivalentId: created.id };
}

export async function readElements(language: string): Promise<StoredElement[]> {
  const code = language.trim().toLowerCase();
  if (!isLearnableLanguage(code) || typeof indexedDB === 'undefined') return [];
  const db = await openDatabase();
  const result = await idbRequest(
    db
      .transaction(ELEMENTS_STORE, 'readonly')
      .objectStore(ELEMENTS_STORE)
      .index('language')
      .getAll(code),
  );
  return materializeElements(Array.isArray(result) ? result : [], code);
}

export async function readAllElements(): Promise<StoredElement[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDatabase();
  const result = await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).getAll(),
  );
  return materializeElements(Array.isArray(result) ? result : []);
}

async function materializeElements(
  records: unknown[],
  language?: LearnableLanguage,
): Promise<StoredElement[]> {
  const stale = records.filter(recordHasDefinitionGem);
  if (stale.length) {
    await Promise.all(
      stale.map(async (record) => {
        const element = normalizeElement(record);
        if (element) await putElement(element);
      }),
    );
  }
  return records
    .map(normalizeElement)
    .filter(
      (element): element is StoredElement =>
        element !== null &&
        element.deletedAt == null &&
        (!language || element.language === language),
    )
    .sort(
      (left, right) => left.createdAt - right.createdAt || left.title.localeCompare(right.title),
    );
}

function recordHasDefinitionGem(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const definitions = (record as { definitions?: unknown }).definitions;
  if (!Array.isArray(definitions)) return false;
  return definitions.some(
    (definition) =>
      !!definition &&
      typeof definition === 'object' &&
      ('gem' in definition || 'frequency' in definition),
  );
}

export async function addElement(language: string, title: string): Promise<StoredElement> {
  const code = language.trim().toLowerCase();
  if (!isLearnableLanguage(code)) {
    throw new Error(`Unsupported language "${language}"`);
  }
  const name = title.trim();
  if (!name) throw new Error('Title is required');
  const existing = (await readElements(code)).find((element) => sameTitle(element.title, name));
  if (existing) return existing;
  const created: StoredElement = {
    id: crypto.randomUUID(),
    language: code,
    title: name,
    equivalents: [],
    definitions: [],
    mode: null,
    comfort: MIN_COMFORT,
    clicks: 0,
    log: [],
    ...emptyMetadataIndexes(),
    createdAt: Date.now(),
    deletedAt: null,
  };
  await putElement(created);
  return created;
}

export async function saveElement(
  element: StoredElement,
  options?: { syncCatalog?: boolean },
): Promise<StoredElement> {
  const language = String(element?.language ?? '')
    .trim()
    .toLowerCase();
  if (!isLearnableLanguage(language)) {
    throw new Error(`Unsupported language "${element?.language ?? ''}"`);
  }
  const title = String(element?.title ?? '').trim();
  if (!title) throw new Error('Title is required');
  const id = String(element?.id ?? '').trim();
  if (!id) throw new Error('Id is required');
  const createdAtValue = element?.createdAt;
  const content = normalizeContent(element?.equivalents, element?.definitions);
  const definitions = content.definitions.map((definition) => ({
    ...definition,
    text: capitalizePassage(definition.text),
    examples: definition.examples.map((example) => ({
      ...example,
      text: capitalizePassage(example.text),
    })),
  }));
  const indexes = collectMetadataIndexes(definitions);
  const saved: StoredElement = {
    id,
    language,
    title,
    equivalents: content.equivalents,
    definitions,
    mode: normalizeElementMode(element?.mode),
    comfort: normalizeComfort(element?.comfort),
    clicks: normalizeClicks(element?.clicks),
    log: normalizeElementLog(element?.log),
    ...indexes,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
    deletedAt: deletedAtOf(element?.deletedAt),
  };
  await putElement(saved);
  if (options?.syncCatalog !== false && !metadataIndexesEmpty(indexes)) {
    await mergeMetadataCatalog(indexes);
  }
  return saved;
}

let elementWriteListener: ((language: string) => void) | null = null;

/** Notified with the language after an element is written. */
export function setElementWriteListener(listener: ((language: string) => void) | null): void {
  elementWriteListener = listener;
}

export async function deleteElement(id: string): Promise<void> {
  const key = id.trim();
  if (!key || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const raw = await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).get(key),
  );
  const element = normalizeElement(raw);
  if (!element || element.deletedAt != null) return;
  await putElement({ ...element, deletedAt: Date.now() });
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function normalizeElement(raw: unknown): StoredElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<StoredElement>;
  const language = String(source.language ?? '')
    .trim()
    .toLowerCase();
  if (!isLearnableLanguage(language)) return null;
  const title = String(source.title ?? '').trim();
  const id = String(source.id ?? '').trim();
  if (!title || !id) return null;
  const createdAtValue = source.createdAt;
  const content = normalizeContent(source.equivalents, source.definitions);
  return {
    id,
    language,
    title,
    equivalents: content.equivalents,
    definitions: content.definitions,
    mode: normalizeElementMode(source.mode),
    comfort: normalizeComfort(source.comfort),
    clicks: normalizeClicks(source.clicks),
    log: normalizeElementLog(source.log),
    ...collectMetadataIndexes(content.definitions),
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
    deletedAt: deletedAtOf(source.deletedAt),
  };
}

function deletedAtOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Missing or unknown values are unset. */
function normalizeElementMode(value: unknown): ElementMode | null {
  const mode = Math.round(Number(value));
  if (mode === 1 || mode === 2 || mode === 3) return mode;
  return null;
}

function normalizeElementLog(value: unknown): ElementLogEntry[] {
  if (!Array.isArray(value)) return [];
  const log: ElementLogEntry[] = [];
  for (const raw of value) {
    const entry = normalizeElementLogEntry(raw);
    if (entry) log.push(entry);
  }
  return log;
}

function normalizeElementLogEntry(raw: unknown): ElementLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as { event?: unknown; at?: unknown; comfort?: unknown };
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  if (source.event === 'click') return { event: 'click', at: source.at };
  if (source.event !== 'comfort') return null;
  const comfort = Math.round(Number(source.comfort));
  if (!Number.isInteger(comfort) || comfort < MIN_COMFORT || comfort > MAX_COMFORT) return null;
  return { event: 'comfort', comfort, at: source.at };
}

/** Missing or invalid values are 0. */
function normalizeClicks(value: unknown): number {
  const clicks = Math.round(Number(value));
  if (!Number.isInteger(clicks) || clicks < 0) return 0;
  return clicks;
}

/** Missing or out-of-range values are 1. */
function normalizeComfort(value: unknown): number {
  const rate = Math.round(Number(value));
  if (!Number.isInteger(rate) || rate < MIN_COMFORT || rate > MAX_COMFORT) return MIN_COMFORT;
  return rate;
}

function normalizeContent(
  rawEquivalents: unknown,
  rawDefinitions: unknown,
): { equivalents: ElementEquivalent[]; definitions: ElementDefinition[] } {
  const equivalents = normalizeEquivalents(rawEquivalents);
  return {
    equivalents,
    definitions: normalizeDefinitions(rawDefinitions, equivalents),
  };
}

function normalizeEquivalents(value: unknown): ElementEquivalent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const equivalents: ElementEquivalent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Partial<ElementEquivalent>;
    const id = typeof source.id === 'string' ? source.id.trim() : '';
    const text = normalizePlainText(source.text);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    equivalents.push({ id, text });
  }
  return equivalents;
}

function normalizeDefinitions(
  value: unknown,
  equivalents: ElementEquivalent[],
): ElementDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: ElementDefinition[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Partial<ElementDefinition> & {
      equivalent?: unknown;
      translation?: unknown;
    };
    const text = withEmbeddedTranslation(String(source.text ?? ''), source.translation);
    if (!text) continue;
    definitions.push({
      text,
      equivalentId: resolveEquivalentId(source, equivalents),
      forms: normalizeForms(source.forms),
      examples: normalizeExamples(source.examples),
      metadata: normalizeMetadata(source.metadata),
      log: normalizeLog(source.log),
    });
  }
  return definitions;
}

function resolveEquivalentId(
  source: { equivalentId?: unknown; equivalent?: unknown },
  equivalents: ElementEquivalent[],
): string | null {
  const id = typeof source.equivalentId === 'string' ? source.equivalentId.trim() : '';
  if (id && equivalents.some((item) => item.id === id)) return id;
  const legacy = normalizePlainText(source.equivalent);
  if (!legacy) return null;
  const match = equivalents.find((item) => item.text === legacy);
  if (match) return match.id;
  const created: ElementEquivalent = { id: crypto.randomUUID(), text: legacy };
  equivalents.push(created);
  return created.id;
}

function normalizePlainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLog(value: unknown): DefinitionLogEntry[] {
  if (!Array.isArray(value)) return [];
  const log: DefinitionLogEntry[] = [];
  for (const raw of value) {
    const entry = normalizeLogEntry(raw);
    if (entry) log.push(entry);
  }
  return log;
}

function normalizeLogEntry(raw: unknown): DefinitionLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as {
    event?: unknown;
    game?: unknown;
    gems?: unknown;
    by?: unknown;
    at?: unknown;
    answer?: unknown;
    explanation?: unknown;
  };
  if (source.event === 'rework' || source.event === 'reveal') {
    if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
    return { event: source.event, at: source.at };
  }
  if (source.event != null && source.event !== 'game') return null;
  if (source.game !== 'translation' && source.game !== 'example' && source.game !== 'definition') {
    return null;
  }
  const gems = Math.round(Number(source.gems));
  if (!Number.isInteger(gems) || gems < 0 || gems > TRANSLATION_GEM_MAX) return null;
  if (source.by !== 'user' && source.by !== 'ai') return null;
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  const answer = typeof source.answer === 'string' ? source.answer : '';
  const explanation =
    typeof source.explanation === 'string' ? source.explanation.replace(/\s+/g, ' ').trim() : '';
  const entry: DefinitionGameLog = {
    event: 'game',
    game: source.game,
    gems,
    by: source.by,
    at: source.at,
    answer,
  };
  if (explanation) entry.explanation = explanation;
  return entry;
}

const TRANSLATION_MARKER = /\[([^\[\]:\n]+):\s*([^\]]*)]/g;

/** First letter of a phrase, leaving the rest of the wording alone. */
function capitalizePhrase(value: string): string {
  return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('en'));
}

/** Capitalize the gloss or example. Translation markers stay attached and unchanged. */
function capitalizePassage(value: string): string {
  const parsed = parsePassage(value);
  const text = capitalizePhrase(parsed.text);
  return parsed.translations.reduce(
    (raw, item) => embedTranslation(raw, item.language, item.text),
    text,
  );
}

type PassageTranslation = {
  language: string;
  text: string;
};

export type ParsedPassage = {
  text: string;
  translations: PassageTranslation[];
};

/** Split `[en: …]` or `[English: …]` markers out of definition or example text. */
export function parsePassage(value: string): ParsedPassage {
  const translations: PassageTranslation[] = [];
  const text = value
    .replace(TRANSLATION_MARKER, (match, label: string, body: string) => {
      const language = languageCodeFromLabel(label);
      const translation = body.trim();
      if (!language) return match;
      if (!translation) return '';
      translations.push({ language, text: capitalizePhrase(translation) });
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, translations };
}

/** The phrase as edited: the gloss, then the selected translation alone inside `[]`. */
export function passageForEditing(value: string, language = ''): string {
  const parsed = parsePassage(value);
  const key = language.trim().toLowerCase().split('-')[0];
  const translation = key
    ? (parsed.translations.find((item) => item.language === key)?.text ?? '')
    : '';
  const base = parsed.text.trim();
  if (!translation) return base;
  return base ? `${base}\n[${translation}]` : `[${translation}]`;
}

/** Read an editing box. A whole line of `[…]` is the translation, with or without a language label. */
export function readEditingDraft(draft: string): { text: string; translation: string } {
  const gloss: string[] = [];
  let translation = '';
  for (const line of draft.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.trim().match(/^\[([^\[\]]+)]$/);
    if (match) translation = translationBody(match[1]);
    else gloss.push(line);
  }
  const parsed = parsePassage(gloss.join('\n'));
  return {
    text: parsed.text,
    translation: translation || parsed.translations.at(-1)?.text || '',
  };
}

function translationBody(body: string): string {
  const labeled = body.match(/^([^:\n]+):\s*([\s\S]+)$/);
  if (labeled && languageCodeFromLabel(labeled[1].trim())) return labeled[2].trim();
  return body.trim();
}

/** Store a translation on a phrase as `Primary [en: …]`, replacing that language's tag. */
export function embedTranslation(raw: string, lang: string, text: string): string {
  const key = lang.trim().toLowerCase().split('-')[0];
  const value = capitalizePhrase(text.replace(/]/g, '').trim());
  const parsed = parsePassage(raw);
  const translations = new Map<string, string>();
  for (const item of parsed.translations) {
    if (item.language && item.text) translations.set(item.language, item.text);
  }
  if (key && value) translations.set(key, value);
  else if (key) translations.delete(key);
  const parts = [...translations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, body]) => `[${language}: ${body}]`);
  const base = parsed.text.trim();
  if (!parts.length) return base;
  return base ? `${base} ${parts.join(' ')}` : parts.join(' ');
}

/** Older records kept a translation field. It now lives in the text as `[en: …]`. */
function withEmbeddedTranslation(text: string, translation: unknown): string {
  const body = text.trim();
  const extra = normalizePlainText(translation);
  if (!extra) return body;
  const marker = `[en: ${extra}]`;
  if (body.includes(marker)) return body;
  return body ? `${body}\n${marker}` : marker;
}

function normalizeForms(value: unknown): ElementForm[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const forms: ElementForm[] = [];
  for (const raw of value) {
    const text = formText(raw);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const metadata =
      raw && typeof raw === 'object'
        ? normalizeMetadata((raw as Partial<ElementForm>).metadata)
        : {};
    forms.push({ text, metadata });
  }
  return forms;
}

function formText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const text = (value as Partial<ElementForm>).text;
  return typeof text === 'string' ? text.trim() : '';
}

function normalizeExamples(value: unknown): ElementExample[] {
  if (!Array.isArray(value)) return [];
  const examples: ElementExample[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Partial<ElementExample> & { translation?: unknown };
    const text = withEmbeddedTranslation(String(source.text ?? ''), source.translation);
    if (!text) continue;
    examples.push({
      text,
      metadata: normalizeMetadata(source.metadata),
    });
  }
  return examples;
}

function normalizeMetadata(value: unknown): ElementMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue;
    const key = rawKey.trim();
    const text = rawValue.trim();
    if (!key || !text) continue;
    metadata[key] = text;
  }
  return metadata;
}

async function putElement(element: StoredElement): Promise<void> {
  const db = await openDatabase();
  await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readwrite').objectStore(ELEMENTS_STORE).put(element),
  );
  elementWriteListener?.(element.language);
}

/** First letter of a title, for display. The stored title is unchanged. */
export function displayTitle(value: string, locale = ''): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\P{L}*)(\p{L})(.*)$/u);
  if (!match) return text;
  const letter = match[2] ?? '';
  const upper = locale ? letter.toLocaleUpperCase(locale) : letter.toLocaleUpperCase();
  if (upper === letter) return text;
  return `${match[1] ?? ''}${upper}${match[3] ?? ''}`;
}
