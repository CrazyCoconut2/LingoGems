import { ELEMENTS_STORE, TRANSLATIONS_STORE, idbRequest, openDatabase } from '../database';
import {
  isLearnableLanguage,
  languageCodeFromLabel,
  languageDisplayName,
  type LearnableLanguage,
} from '../languages/catalog';
import {
  adoptPhraseTranslations,
  normalizeStoredPhraseTranslations,
  stagePhraseTranslations,
  withPhraseTranslationWrite,
} from '../translations/phrase-store';
import {
  mergeMetadataCatalog,
  normalizeElementCatalog,
  replaceMetadataCatalog,
  type ElementCatalog,
} from './metadata-catalog';
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
  /** Learnable code this equivalent was written in. */
  language: string;
};

/** Support-language code to the equivalent id written in that language. */
export type EquivalentLinks = Record<string, string>;

export type ElementForm = {
  text: string;
  metadata: ElementMetadata;
};

/** Highest stored score for a recall, including the extra sense point. */
export const DEFINITION_COVERAGE_MAX = 10;
export const DEFINITION_SCORE_MAX = 11;

export type DefinitionLogBy = 'user' | 'ai';

export type DefinitionGame = 'definition';

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
  /** Score from 0 to {@link DEFINITION_SCORE_MAX}. */
  score: number;
  by: DefinitionLogBy;
  at: number;
  answer: string;
  explanation?: string;
  /** The answer named a sense that was not stored, so the score includes one extra point. */
  extra?: true;
  /** Definition when this attempt was first scored. */
  snapshot?: DefinitionSnapshot;
  /** Set when this recall was finished and earned a gem. */
  gem?: GemTier;
};

/** A change to the definition passage, its equivalent, or its metadata. */
export type DefinitionReworkLog = {
  event: 'rework';
  at: number;
  before?: DefinitionSnapshot;
  after?: DefinitionSnapshot;
};

/** A definition removed from the element, with the wording and the pieces that belonged to it. */
export type DefinitionDeleteLog = {
  event: 'delete';
  at: number;
  definition?: DefinitionSnapshot;
  forms?: ElementForm[];
  examples?: { text: string; metadata: ElementMetadata }[];
  /** Equivalent wording for each support language this sense was linked to. */
  equivalents?: { language: string; text: string }[];
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

/** A translation uncovered on a definition or one of its examples. */
export type DefinitionRevealLog = {
  event: 'reveal';
  at: number;
  /** Definition or example wording that was on screen. */
  phrase?: string;
  /** Translation that was uncovered. */
  translation?: string;
  /** Which passage was uncovered. */
  kind?: 'definition' | 'example';
};

/** One activity entry. `at` is Unix time in UTC. Stored on the element. */
export type DefinitionLogEntry =
  | DefinitionGameLog
  | DefinitionReworkLog
  | DefinitionDeleteLog
  | DefinitionExampleLog
  | DefinitionFormLog
  | DefinitionRevealLog
  | { event: 'view'; at: number };

/** An interaction on an element. `at` is when it happened. */
export type ElementLogEntry = { event: 'click'; at: number } | DefinitionLogEntry;

export type ElementDefinition = {
  text: string;
  /** One equivalent per support language. Other languages stay when one of them changes. */
  equivalentIds: EquivalentLinks;
  forms: ElementForm[];
  examples: ElementExample[];
  metadata: ElementMetadata;
};

/** A definition taken out of the editor. */
export type RemovedDefinition = ElementDefinition & { deletedAt: number };

const GEM_TIERS = ['red', 'orange', 'green'] as const;

export type GemTier = (typeof GEM_TIERS)[number];

/** Gems earned from recall exercises. One count per color. */
export type ElementGemCounts = Record<GemTier, number>;

/** Coverage out of 10 for a recall. The extra sense point is not part of it. */
export function definitionCoverage(entry: { score: number; extra?: boolean }): number {
  const coverage = entry.extra ? entry.score - 1 : entry.score;
  return Math.min(DEFINITION_COVERAGE_MAX, Math.max(0, coverage));
}

/**
 * The gem for one finished recall compared with the mean of earlier coverages.
 * The first recall has no average, and a score under the average earns nothing.
 * A coverage of 0 earns nothing.
 * A gap of 0 up to 1.5 is red, 1.5 up to 3 is orange, and 3 or more is green.
 * Giving up is not a finished exercise, so it earns nothing.
 */
function gemTierForScore(priorSum: number, priorCount: number, score: number): GemTier | null {
  if (priorCount <= 0 || !Number.isFinite(score) || score <= 0) return null;
  const gap = score - priorSum / priorCount;
  if (!(gap >= 0)) return null;
  if (gap < 1.5) return 'red';
  if (gap < 3) return 'orange';
  return 'green';
}

/** A recall was finished when an answer was kept. Giving up stores an empty answer. */
function recallFinished(entry: { answer?: string }): boolean {
  return !!entry.answer?.trim();
}

/** The gem stored on this recall when it was finished, or null. */
export function storedGem(entry: { gem?: unknown }): GemTier | null {
  return entry.gem === 'red' || entry.gem === 'orange' || entry.gem === 'green' ? entry.gem : null;
}

/**
 * The gem a finished recall earns against earlier coverages.
 * Written onto the log entry when the exercise is finished.
 */
export function attributeGem(
  log: readonly ElementLogEntry[],
  entry: DefinitionGameLog,
): GemTier | null {
  if (entry.game !== 'definition' || !recallFinished(entry) || !Number.isFinite(entry.score)) {
    return null;
  }
  let priorSum = 0;
  let priorCount = 0;
  for (const attempt of orderedGameAttempts(log, 'definition')) {
    if (attempt === entry || attempt.at > entry.at) continue;
    if (!Number.isFinite(attempt.score)) continue;
    priorSum += definitionCoverage(attempt);
    priorCount += 1;
  }
  return gemTierForScore(priorSum, priorCount, definitionCoverage(entry));
}

/** Gems stored on this element's finished recalls. */
export function elementGemCounts(element: { log?: readonly ElementLogEntry[] }): ElementGemCounts {
  const counts: ElementGemCounts = { red: 0, orange: 0, green: 0 };
  for (const entry of element.log ?? []) {
    if (entry.event !== 'game') continue;
    const gem = storedGem(entry);
    if (gem) counts[gem] += 1;
  }
  return counts;
}

/** One game's scored attempts, oldest first. Equal timestamps keep log order. */
function orderedGameAttempts(
  log: readonly ElementLogEntry[],
  game: DefinitionGame,
): DefinitionGameLog[] {
  const attempts: { entry: DefinitionGameLog; index: number }[] = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (entry?.event === 'game' && entry.game === game) attempts.push({ entry, index });
  }
  attempts.sort((left, right) => left.entry.at - right.entry.at || left.index - right.index);
  return attempts.map((item) => item.entry);
}

/** The strings a form list is matched and highlighted with. */
export function formTexts(forms: readonly ElementForm[]): string[] {
  return forms.map((form) => form.text);
}

export type StoredElement = {
  id: string;
  language: LearnableLanguage;
  title: string;
  equivalents: ElementEquivalent[];
  definitions: ElementDefinition[];
  /** Definitions removed from the editor. */
  removedDefinitions: RemovedDefinition[];
  /** Times this card was opened from the edition list. Missing values are 0. */
  clicks: number;
  /** Opens and activity. Missing values are an empty log. */
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

/** Link each sense's support-language equivalent. Empty wording leaves that sense unlinked. */
export function sensesWithEquivalents<T extends { equivalent?: string }>(
  equivalents: readonly ElementEquivalent[],
  language: string,
  senses: readonly T[],
): {
  equivalents: ElementEquivalent[];
  senses: Array<Omit<T, 'equivalent'> & { equivalentIds: EquivalentLinks }>;
} {
  let pool = [...equivalents];
  const next = senses.map((sense) => {
    const { equivalent, ...rest } = sense;
    const linked = assignEquivalent(pool, equivalent ?? '', language);
    pool = linked.equivalents;
    return {
      ...rest,
      equivalentIds: linkEquivalent({}, language, linked.equivalentId),
    };
  });
  return { equivalents: pool, senses: next };
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
  return materializeElements(await readLanguageRecords(code), code);
}

export async function readAllElements(): Promise<StoredElement[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDatabase();
  const result = await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).getAll(),
  );
  return materializeElements(Array.isArray(result) ? result : []);
}

function materializeElements(records: unknown[], language?: LearnableLanguage): StoredElement[] {
  return records
    .map(normalizeElement)
    .filter(
      (element): element is StoredElement =>
        element !== null && (!language || element.language === language),
    )
    .sort(
      (left, right) => left.createdAt - right.createdAt || left.title.localeCompare(right.title),
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
    clicks: normalizeClicks(element?.clicks),
    log: readElementLog(element),
    ...indexes,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
  await putElement(saved);
  if (options?.syncCatalog !== false && !metadataIndexesEmpty(indexes)) {
    await enqueueCatalogWrite(() => mergeMetadataCatalog(indexes));
  }
  return saved;
}

let elementWriteListener: ((language: string) => void) | null = null;

/** Notified with the language after an element is written. */
export function setElementWriteListener(listener: ((language: string) => void) | null): void {
  elementWriteListener = listener;
}

/** Replaces elements, the catalog, and phrase translations, then notifies once per language. */
export function replaceCollection(
  elements: readonly unknown[],
  catalog: unknown,
  translations: readonly unknown[],
): Promise<string[]> {
  return enqueueCatalogWrite(() =>
    withPhraseTranslationWrite(() => writeCollection(elements, catalog, translations)),
  );
}

async function writeCollection(
  elements: readonly unknown[],
  catalog: unknown,
  translations: readonly unknown[],
): Promise<string[]> {
  const saved: StoredElement[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    const element = normalizeElement(raw);
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    saved.push(element);
  }
  const next = normalizeElementCatalog(catalog);
  if (typeof indexedDB === 'undefined') {
    adoptPhraseTranslations(normalizeStoredPhraseTranslations(translations));
    await replaceMetadataCatalog(next);
    return [];
  }
  const db = await openDatabase();
  const tx = db.transaction([ELEMENTS_STORE, TRANSLATIONS_STORE], 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(ELEMENTS_STORE);
  store.clear();
  for (const element of saved) store.put(element);
  const phrases = stagePhraseTranslations(tx, translations);
  await done;
  await replaceMetadataCatalog(next);
  adoptPhraseTranslations(phrases);
  const languages = [...new Set(saved.map((element) => element.language))];
  for (const language of languages) elementWriteListener?.(language);
  return languages;
}

export async function deleteElement(id: string): Promise<void> {
  const element = await readStoredElement(id);
  if (!element || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readwrite').objectStore(ELEMENTS_STORE).delete(element.id),
  );
  elementWriteListener?.(element.language);
}

async function readLanguageRecords(language: string): Promise<unknown[]> {
  const db = await openDatabase();
  const result = await idbRequest(
    db
      .transaction(ELEMENTS_STORE, 'readonly')
      .objectStore(ELEMENTS_STORE)
      .index('language')
      .getAll(language),
  );
  return Array.isArray(result) ? result : [];
}

async function readStoredElement(id: string): Promise<StoredElement | null> {
  const key = id.trim();
  if (!key || typeof indexedDB === 'undefined') return null;
  const db = await openDatabase();
  const raw = await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).get(key),
  );
  return normalizeElement(raw);
}

let catalogWrite: Promise<void> = Promise.resolve();

function enqueueCatalogWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = catalogWrite.then(work, work);
  catalogWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Replaces the catalog after any in-flight catalog write, so the two cannot overwrite each other. */
export function commitElementCatalog(
  indexes: Parameters<typeof replaceMetadataCatalog>[0],
): Promise<ElementCatalog> {
  return enqueueCatalogWrite(() => replaceMetadataCatalog(indexes));
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
    clicks: normalizeClicks(source.clicks),
    log: readElementLog(source),
    ...collectMetadataIndexes(content.definitions),
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
}

function readElementLog(raw: unknown): ElementLogEntry[] {
  const source = raw && typeof raw === 'object' ? (raw as { log?: unknown }) : {};
  return presentLog(normalizeElementLog(source.log));
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
  if (source.event === 'click') {
    if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
    return { event: 'click', at: source.at };
  }
  return normalizeLogEntry(raw);
}

/** Missing or invalid values are 0. */
function normalizeClicks(value: unknown): number {
  const clicks = Math.round(Number(value));
  if (!Number.isInteger(clicks) || clicks < 0) return 0;
  return clicks;
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
    const language = supportCode(source.language ?? '');
    if (!id || !text || !language || seen.has(id)) continue;
    seen.add(id);
    equivalents.push({ id, text, language });
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
    const source = raw as Partial<ElementDefinition>;
    const text = String(source.text ?? '').trim();
    if (!text) continue;
    definitions.push({
      text,
      equivalentIds: resolveEquivalentIds(source, equivalents),
      forms: normalizeForms(source.forms),
      examples: normalizeExamples(source.examples),
      metadata: normalizeMetadata(source.metadata),
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
  source: { equivalentIds?: unknown },
  equivalents: ElementEquivalent[],
): EquivalentLinks {
  if (
    !source.equivalentIds ||
    typeof source.equivalentIds !== 'object' ||
    Array.isArray(source.equivalentIds)
  ) {
    return {};
  }
  return linksFromRecord(source.equivalentIds, equivalents);
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

function normalizeLogEntry(raw: unknown): DefinitionLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as {
    event?: unknown;
    game?: unknown;
    score?: unknown;
    by?: unknown;
    at?: unknown;
    answer?: unknown;
    explanation?: unknown;
    extra?: unknown;
    gem?: unknown;
    example?: unknown;
    forms?: unknown;
    before?: unknown;
    after?: unknown;
    definition?: unknown;
    examples?: unknown;
    equivalents?: unknown;
    snapshot?: unknown;
    phrase?: unknown;
    translation?: unknown;
    kind?: unknown;
  };
  const at = typeof source.at === 'number' && Number.isFinite(source.at) ? source.at : null;
  if (source.event === 'view') {
    if (at == null) return null;
    return { event: 'view', at };
  }
  if (source.event === 'reveal') {
    if (at == null) return null;
    const phrase = typeof source.phrase === 'string' ? source.phrase.trim() : '';
    const translation = typeof source.translation === 'string' ? source.translation.trim() : '';
    const kind =
      source.kind === 'definition' || source.kind === 'example' ? source.kind : undefined;
    return {
      event: 'reveal',
      at,
      ...(phrase ? { phrase } : {}),
      ...(translation ? { translation } : {}),
      ...(kind ? { kind } : {}),
    };
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
  if (source.event === 'delete') {
    if (at == null) return null;
    const definition = normalizeSnapshot(source.definition);
    const forms = normalizeForms(source.forms);
    const examples = normalizeExamples(source.examples);
    const equivalents = normalizeEquivalentCopies(source.equivalents);
    return {
      event: 'delete',
      at,
      ...(definition ? { definition } : {}),
      ...(forms.length ? { forms } : {}),
      ...(examples.length ? { examples } : {}),
      ...(equivalents.length ? { equivalents } : {}),
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
  if (source.game !== 'definition') return null;
  const score = Math.round(Number(source.score));
  if (!Number.isInteger(score) || score < 0 || score > DEFINITION_SCORE_MAX) return null;
  if (source.by !== 'user' && source.by !== 'ai') return null;
  if (typeof source.at !== 'number' || !Number.isFinite(source.at)) return null;
  const answer = typeof source.answer === 'string' ? source.answer : '';
  const explanation =
    typeof source.explanation === 'string' ? source.explanation.replace(/\s+/g, ' ').trim() : '';
  const entry: DefinitionGameLog = {
    event: 'game',
    game: 'definition',
    score,
    by: source.by,
    at: source.at,
    answer,
  };
  if (explanation) entry.explanation = explanation;
  if (source.extra === true && source.game === 'definition' && score > 0) entry.extra = true;
  const gem = storedGem(source);
  if (gem && source.game === 'definition' && answer.trim()) entry.gem = gem;
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
  };
}

function presentLog(log: ElementLogEntry[]): ElementLogEntry[] {
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
    if (entry.event === 'delete') {
      const definition = entry.definition ? presentSnapshot(entry.definition) : undefined;
      const forms = entry.forms?.map((form) => ({
        text: form.text.trim(),
        metadata: form.metadata,
      }));
      const examples = entry.examples?.map((example) => ({
        text: capitalizePassage(example.text),
        metadata: example.metadata,
      }));
      const equivalents = entry.equivalents?.map((item) => ({
        language: item.language,
        text: item.text.trim(),
      }));
      return {
        event: 'delete',
        at: entry.at,
        ...(definition ? { definition } : {}),
        ...(forms?.length ? { forms } : {}),
        ...(examples?.length ? { examples } : {}),
        ...(equivalents?.length ? { equivalents } : {}),
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
    if (entry.event === 'reveal') {
      const phrase = entry.phrase ? capitalizePhrase(entry.phrase) : '';
      const translation = entry.translation ? capitalizePhrase(entry.translation) : '';
      return {
        event: 'reveal',
        at: entry.at,
        ...(phrase ? { phrase } : {}),
        ...(translation ? { translation } : {}),
        ...(entry.kind ? { kind: entry.kind } : {}),
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

function normalizeEquivalentCopies(value: unknown): { language: string; text: string }[] {
  if (!Array.isArray(value)) return [];
  const copies: { language: string; text: string }[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as { language?: unknown; text?: unknown };
    const language =
      typeof source.language === 'string' ? source.language.trim().toLowerCase() : '';
    const text = typeof source.text === 'string' ? source.text.trim() : '';
    if (!language || !text) continue;
    copies.push({ language, text });
  }
  return copies;
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
    const source = raw as Partial<ElementExample>;
    const text = String(source.text ?? '').trim();
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
