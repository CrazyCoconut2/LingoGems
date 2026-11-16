import { CATALOG_ID, CATALOG_STORE, ELEMENTS_STORE, idbRequest, openDatabase } from '../database';
import {
  isLearnableLanguage,
  languageCodeFromLabel,
  languageDisplayName,
  type LearnableLanguage,
} from '../languages/catalog';
import { customElementColor, ELEMENT_COLOR_PRESETS, sanitizeElementColor } from './element-color';
import { mergeMetadataCatalog, normalizeElementCatalog } from './metadata-catalog';
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
  /** Learnable code this equivalent was written in. Empty on older records, which stay hidden. */
  language: string;
};

/** Support-language code to the equivalent id written in that language. */
export type EquivalentLinks = Record<string, string>;

export type ElementForm = {
  text: string;
  metadata: ElementMetadata;
};

/** Highest score one answer can receive. */
export const TRANSLATION_GEM_MAX = 5;

export type DefinitionLogBy = 'user' | 'ai';

export type DefinitionGame = 'translation' | 'example' | 'definition';

/** The definition passage, equivalent wording, and metadata at one moment. */
export type DefinitionSnapshot = {
  text: string;
  equivalent: string;
  metadata?: ElementMetadata;
};

/** A scored answer. `game` through `explanation` is the metadata for that answer. */
export type DefinitionGameLog = {
  event: 'game';
  game: DefinitionGame;
  /** Score from 0 to {@link TRANSLATION_GEM_MAX}. Older records stored this as `gems`. */
  score: number;
  by: DefinitionLogBy;
  at: number;
  answer: string;
  explanation?: string;
  /** Definition when this attempt was first scored. */
  snapshot?: DefinitionSnapshot;
};

/** A change to the definition passage, its equivalent, or its metadata. */
export type DefinitionReworkLog = {
  event: 'rework';
  at: number;
  before?: DefinitionSnapshot;
  after?: DefinitionSnapshot;
};

/** An example added to the definition. */
export type DefinitionExampleLog = {
  event: 'example';
  at: number;
  example: string;
  snapshot?: DefinitionSnapshot;
};

/** Forms saved onto the definition in one action. */
export type DefinitionFormLog = {
  event: 'form';
  at: number;
  forms: string[];
  snapshot?: DefinitionSnapshot;
};

/** One interaction on a definition. `at` is Unix time in UTC. */
export type DefinitionLogEntry =
  | DefinitionGameLog
  | DefinitionReworkLog
  | DefinitionExampleLog
  | DefinitionFormLog
  | { event: 'view'; at: number }
  | { event: 'reveal'; at: number };

/** An open. `at` is when it happened. */
export type ElementLogEntry = { event: 'click'; at: number };

export type ElementDefinition = {
  text: string;
  /** One equivalent per support language. Other languages stay when one of them changes. */
  equivalentIds: EquivalentLinks;
  forms: ElementForm[];
  examples: ElementExample[];
  metadata: ElementMetadata;
  log: DefinitionLogEntry[];
};

/** A definition taken out of the editor. Its log still counts in stats. */
export type RemovedDefinition = ElementDefinition & { deletedAt: number };

/** Live definitions and removed ones. Stats count both logs. */
export function loggedDefinitions(element: {
  definitions: readonly ElementDefinition[];
  removedDefinitions?: readonly ElementDefinition[];
}): ElementDefinition[] {
  return [...element.definitions, ...(element.removedDefinitions ?? [])];
}

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

/** What the player does in one exercise. */
export function elementModeHelp(mode: ElementMode): string {
  if (mode === 1) {
    return `Write the equivalent for each definition. Then score it from 0 to ${TRANSLATION_GEM_MAX}, or ask the AI.`;
  }
  if (mode === 2) {
    return `Write an example for each definition. The AI checks that it uses a valid form of the word and that the other words show that sense, then scores it from 0 to ${TRANSLATION_GEM_MAX}.`;
  }
  return `Write each hidden definition and submit it. Then score it from 0 to ${TRANSLATION_GEM_MAX}, or ask the AI. Or give up to see it.`;
}

export type StoredElement = {
  id: string;
  language: LearnableLanguage;
  title: string;
  equivalents: ElementEquivalent[];
  definitions: ElementDefinition[];
  /** Definitions removed from the editor. Their logs stay so stats do not drop. */
  removedDefinitions: RemovedDefinition[];
  /** Optional swatch. Missing or invalid values are unset. */
  color: string | null;
  /** Times this card was opened from the edition list. Missing values are 0. */
  clicks: number;
  /** Dated opens. Missing values are an empty log. */
  log: ElementLogEntry[];
  /** Distinct metadata values across this element's definitions. */
  definitionMetadata: ElementMetadataVariability;
  /** Distinct metadata values across this element's examples. */
  exampleMetadata: ElementMetadataVariability;
  /** Distinct metadata values across this element's forms. */
  formMetadata: ElementMetadataVariability;
  createdAt: number;
};

/** Empty text clears the link. An exact text match reuses that equivalent in the same language. */
export function assignEquivalent(
  equivalents: readonly ElementEquivalent[],
  draft: string,
  language: string,
): { equivalents: ElementEquivalent[]; equivalentId: string | null } {
  const text = draft.trim();
  const code = supportCode(language);
  if (!text || !code) return { equivalents: [...equivalents], equivalentId: null };
  const existing = equivalents.find((item) => item.language === code && item.text === text);
  if (existing) return { equivalents: [...equivalents], equivalentId: existing.id };
  const created: ElementEquivalent = { id: crypto.randomUUID(), text, language: code };
  return { equivalents: [...equivalents, created], equivalentId: created.id };
}

/** Wording linked for one support language, or '' when that language has none. */
export function equivalentTextFor(
  equivalents: readonly ElementEquivalent[],
  links: EquivalentLinks,
  language: string,
): string {
  const code = supportCode(language);
  if (!code) return '';
  const id = links[code];
  if (!id) return '';
  return equivalents.find((item) => item.id === id && item.language === code)?.text ?? '';
}

/** Set or clear one language without dropping the others. */
export function linkEquivalent(
  links: EquivalentLinks,
  language: string,
  equivalentId: string | null,
): EquivalentLinks {
  const code = supportCode(language);
  const next = { ...links };
  if (!code) return next;
  if (!equivalentId) delete next[code];
  else next[code] = equivalentId;
  return next;
}

/** Drop links whose equivalent is no longer in the pool. */
export function pruneEquivalentLinks(
  links: EquivalentLinks,
  kept: ReadonlySet<string>,
): EquivalentLinks {
  const next: EquivalentLinks = {};
  for (const [language, id] of Object.entries(links)) {
    if (kept.has(id)) next[language] = id;
  }
  return next;
}

/** Editing line for one translation, such as `[English: this and that]`. */
export function labeledSupportText(language: string, text: string): string {
  const body = text.trim();
  if (!body) return '';
  const code = supportCode(language);
  const name = code ? languageDisplayName(code) : '';
  if (!name) return body;
  return `[${name}: ${body}]`;
}

function supportCode(language: string): string {
  const code = language.trim().toLowerCase().split('-')[0] ?? '';
  return isLearnableLanguage(code) ? code : '';
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
  const removed = records
    .map(removedRecord)
    .filter((record): record is RemovedRecord => record !== null);
  if (removed.length) await purgeElements(removed);
  const live = records.filter((record) => !removedRecord(record));
  const stale = live.filter(recordHasDefinitionGem);
  if (stale.length) {
    await Promise.all(
      stale.map(async (record) => {
        const element = normalizeElement(record);
        if (element) await putElement(element);
      }),
    );
  }
  return live
    .map(normalizeElement)
    .filter(
      (element): element is StoredElement =>
        element !== null && (!language || element.language === language),
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
    removedDefinitions: [],
    color: ELEMENT_COLOR_PRESETS[0],
    clicks: 0,
    log: [],
    ...emptyMetadataIndexes(),
    createdAt: Date.now(),
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
  const definitions = content.definitions.map(presentDefinition);
  const removedDefinitions = normalizeRemovedDefinitions(
    element?.removedDefinitions,
    content.equivalents,
  ).map(presentDefinition);
  const indexes = collectMetadataIndexes(definitions);
  const saved: StoredElement = {
    id,
    language,
    title,
    equivalents: content.equivalents,
    definitions,
    removedDefinitions,
    color: normalizeColor(element?.color),
    clicks: normalizeClicks(element?.clicks),
    log: normalizeElementLog(element?.log),
    ...indexes,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
  await putElement(saved);
  if (
    options?.syncCatalog !== false &&
    (!metadataIndexesEmpty(indexes) || customElementColor(saved.color))
  ) {
    await mergeMetadataCatalog({ ...indexes, colors: saved.color ? [saved.color] : [] });
  }
  return saved;
}

let elementWriteListener: ((language: string) => void) | null = null;

/** Notified with the language after an element is written. */
export function setElementWriteListener(listener: ((language: string) => void) | null): void {
  elementWriteListener = listener;
}

/** Replaces every element and the metadata catalog, then notifies once per language. */
export async function replaceCollection(
  elements: readonly unknown[],
  catalog: unknown,
): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [];
  const saved: StoredElement[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    if (removedRecord(raw)) continue;
    const element = normalizeElement(raw);
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    saved.push(element);
  }
  const indexes = normalizeElementCatalog(catalog);
  const db = await openDatabase();
  const tx = db.transaction([ELEMENTS_STORE, CATALOG_STORE], 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(ELEMENTS_STORE);
  store.clear();
  for (const element of saved) store.put(element);
  tx.objectStore(CATALOG_STORE).put({ id: CATALOG_ID, ...indexes });
  await done;
  const languages = [...new Set(saved.map((element) => element.language))];
  for (const language of languages) elementWriteListener?.(language);
  return languages;
}

export async function deleteElement(id: string): Promise<void> {
  const key = id.trim();
  if (!key || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const raw = await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).get(key),
  );
  await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readwrite').objectStore(ELEMENTS_STORE).delete(key),
  );
  const language = languageOf(raw);
  if (language) elementWriteListener?.(language);
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    tx.onabort = fail;
  });
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
    removedDefinitions: normalizeRemovedDefinitions(source.removedDefinitions, content.equivalents),
    color: normalizeColor(source.color),
    clicks: normalizeClicks(source.clicks),
    log: normalizeElementLog(source.log),
    ...collectMetadataIndexes(content.definitions),
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
}

type RemovedRecord = { id: string; language: string };

/** An older build kept a removed element and stamped `deletedAt`. Drop that row. */
function removedRecord(record: unknown): RemovedRecord | null {
  if (!record || typeof record !== 'object') return null;
  const source = record as { id?: unknown; language?: unknown; deletedAt?: unknown };
  const deletedAt = source.deletedAt;
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt) || deletedAt <= 0) return null;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) return null;
  return { id, language: languageOf(source) };
}

function languageOf(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const language = String((record as { language?: unknown }).language ?? '')
    .trim()
    .toLowerCase();
  return isLearnableLanguage(language) ? language : '';
}

async function purgeElements(removed: RemovedRecord[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(ELEMENTS_STORE, 'readwrite');
  const store = tx.objectStore(ELEMENTS_STORE);
  for (const record of removed) store.delete(record.id);
  await transactionDone(tx);
  for (const language of new Set(removed.map((record) => record.language).filter(Boolean))) {
    elementWriteListener?.(language);
  }
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
  const source = raw as { event?: unknown; at?: unknown };
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  if (source.event !== 'click') return null;
  return { event: 'click', at: source.at };
}

/** Missing or invalid values are 0. */
function normalizeClicks(value: unknown): number {
  const clicks = Math.round(Number(value));
  if (!Number.isInteger(clicks) || clicks < 0) return 0;
  return clicks;
}

/** Missing or invalid values are unset. */
function normalizeColor(value: unknown): string | null {
  return sanitizeElementColor(value);
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
    equivalents.push({ id, text, language: supportCode(source.language ?? '') });
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
      equivalentId?: unknown;
      translation?: unknown;
    };
    const text = withEmbeddedTranslation(String(source.text ?? ''), source.translation);
    if (!text) continue;
    definitions.push({
      text,
      equivalentIds: resolveEquivalentIds(source, equivalents),
      forms: normalizeForms(source.forms),
      examples: normalizeExamples(source.examples),
      metadata: normalizeMetadata(source.metadata),
      log: normalizeLog(source.log),
    });
  }
  return definitions;
}

/** Drop a removed definition whose stamp or text does not survive. */
function normalizeRemovedDefinitions(
  value: unknown,
  equivalents: ElementEquivalent[],
): RemovedDefinition[] {
  if (!Array.isArray(value)) return [];
  const removed: RemovedDefinition[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const deletedAt = (raw as { deletedAt?: unknown }).deletedAt;
    if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt) || deletedAt <= 0) continue;
    const [definition] = normalizeDefinitions([raw], equivalents);
    if (!definition) continue;
    removed.push({ ...definition, deletedAt });
  }
  return removed;
}

function resolveEquivalentIds(
  source: { equivalentId?: unknown; equivalentIds?: unknown; equivalent?: unknown },
  equivalents: ElementEquivalent[],
): EquivalentLinks {
  if (
    source.equivalentIds &&
    typeof source.equivalentIds === 'object' &&
    !Array.isArray(source.equivalentIds)
  ) {
    return linksFromRecord(source.equivalentIds, equivalents);
  }
  const links: EquivalentLinks = {};
  const id = typeof source.equivalentId === 'string' ? source.equivalentId.trim() : '';
  if (id) {
    const item = equivalents.find((entry) => entry.id === id);
    if (item?.language) links[item.language] = item.id;
    return links;
  }
  const legacy = normalizePlainText(source.equivalent);
  if (!legacy) return links;
  const match = equivalents.find((item) => item.language && item.text === legacy);
  if (match?.language) {
    links[match.language] = match.id;
    return links;
  }
  if (!equivalents.some((item) => !item.language && item.text === legacy)) {
    equivalents.push({ id: crypto.randomUUID(), text: legacy, language: '' });
  }
  return links;
}

function linksFromRecord(
  value: object,
  equivalents: readonly ElementEquivalent[],
): EquivalentLinks {
  const links: EquivalentLinks = {};
  for (const [rawLanguage, rawId] of Object.entries(value)) {
    const language = supportCode(rawLanguage);
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!language || !id) continue;
    const item = equivalents.find((entry) => entry.id === id);
    if (!item || item.language !== language) continue;
    links[language] = id;
  }
  return links;
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
    score?: unknown;
    /** Older records stored the score in `gems`. */
    gems?: unknown;
    by?: unknown;
    at?: unknown;
    answer?: unknown;
    explanation?: unknown;
    example?: unknown;
    forms?: unknown;
    before?: unknown;
    after?: unknown;
    snapshot?: unknown;
  };
  const at = typeof source.at === 'number' && Number.isFinite(source.at) ? source.at : null;
  if (source.event === 'view' || source.event === 'reveal') {
    if (at == null) return null;
    return { event: source.event, at };
  }
  if (source.event === 'rework') {
    if (at == null) return null;
    const before = normalizeSnapshot(source.before);
    const after = normalizeSnapshot(source.after);
    return {
      event: 'rework',
      at,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  }
  if (source.event === 'example') {
    if (at == null) return null;
    const snapshot = normalizeSnapshot(source.snapshot);
    return {
      event: 'example',
      at,
      example: typeof source.example === 'string' ? source.example : '',
      ...(snapshot ? { snapshot } : {}),
    };
  }
  if (source.event === 'form') {
    if (at == null) return null;
    const forms = Array.isArray(source.forms)
      ? source.forms.flatMap((item) => (typeof item === 'string' && item.trim() ? [item] : []))
      : [];
    const snapshot = normalizeSnapshot(source.snapshot);
    return {
      event: 'form',
      at,
      forms,
      ...(snapshot ? { snapshot } : {}),
    };
  }
  if (source.event != null && source.event !== 'game') return null;
  if (source.game !== 'translation' && source.game !== 'example' && source.game !== 'definition') {
    return null;
  }
  const score = Math.round(Number(source.score ?? source.gems));
  if (!Number.isInteger(score) || score < 0 || score > TRANSLATION_GEM_MAX) return null;
  if (source.by !== 'user' && source.by !== 'ai') return null;
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  const answer = typeof source.answer === 'string' ? source.answer : '';
  const explanation =
    typeof source.explanation === 'string' ? source.explanation.replace(/\s+/g, ' ').trim() : '';
  const entry: DefinitionGameLog = {
    event: 'game',
    game: source.game,
    score,
    by: source.by,
    at: source.at,
    answer,
  };
  if (explanation) entry.explanation = explanation;
  const snapshot = normalizeSnapshot(source.snapshot);
  if (snapshot) entry.snapshot = snapshot;
  return entry;
}

/** Keep a snapshot only when both the passage and the equivalent wording are strings. */
function normalizeSnapshot(value: unknown): DefinitionSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as { text?: unknown; equivalent?: unknown; metadata?: unknown };
  if (typeof source.text !== 'string' || typeof source.equivalent !== 'string') return undefined;
  const metadata = normalizeMetadata(source.metadata);
  return {
    text: source.text,
    equivalent: source.equivalent,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

/** Match stored passages: the gloss and an added example are capitalized, the equivalent wording is not. */
function presentDefinition<T extends ElementDefinition>(definition: T): T {
  return {
    ...definition,
    text: capitalizePassage(definition.text),
    examples: definition.examples.map((example) => ({
      ...example,
      text: capitalizePassage(example.text),
    })),
    log: presentLog(definition.log),
  };
}

function presentLog(log: DefinitionLogEntry[]): DefinitionLogEntry[] {
  return log.map((entry) => {
    if (entry.event === 'game') {
      return entry.snapshot ? { ...entry, snapshot: presentSnapshot(entry.snapshot) } : entry;
    }
    if (entry.event === 'rework') {
      const before = entry.before ? presentSnapshot(entry.before) : undefined;
      const after = entry.after ? presentSnapshot(entry.after) : undefined;
      return {
        event: 'rework',
        at: entry.at,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      };
    }
    if (entry.event === 'example') {
      return {
        event: 'example',
        at: entry.at,
        example: capitalizePassage(entry.example),
        ...(entry.snapshot ? { snapshot: presentSnapshot(entry.snapshot) } : {}),
      };
    }
    if (entry.event === 'form') {
      return {
        event: 'form',
        at: entry.at,
        forms: entry.forms.map((form) => form.trim()).filter(Boolean),
        ...(entry.snapshot ? { snapshot: presentSnapshot(entry.snapshot) } : {}),
      };
    }
    return entry;
  });
}

function presentSnapshot(snapshot: DefinitionSnapshot): DefinitionSnapshot {
  return {
    text: capitalizePassage(snapshot.text),
    equivalent: snapshot.equivalent.trim(),
    ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
  };
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

/** The phrase as edited: the gloss, then the selected translation as `[English: …]`. */
export function passageForEditing(value: string, language = ''): string {
  const parsed = parsePassage(value);
  const key = supportCode(language);
  const translation = key
    ? (parsed.translations.find((item) => item.language === key)?.text ?? '')
    : '';
  const base = parsed.text.trim();
  if (!translation) return base;
  const labeled = labeledSupportText(key, translation);
  return base ? `${base}\n${labeled}` : labeled;
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
