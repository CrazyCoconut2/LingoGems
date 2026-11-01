import { ELEMENTS_STORE, idbRequest, openDatabase } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from '../languages/catalog';

export type ElementMetadata = Record<string, string>;

export type ElementExample = {
  text: string;
  metadata: ElementMetadata;
};

export type ElementEquivalent = {
  id: string;
  text: string;
};

export type ElementDefinition = {
  text: string;
  equivalentId: string | null;
  forms: string[];
  examples: ElementExample[];
  metadata: ElementMetadata;
};

export type StoredElement = {
  id: string;
  language: LearnableLanguage;
  title: string;
  equivalents: ElementEquivalent[];
  definitions: ElementDefinition[];
  createdAt: number;
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
  const records = Array.isArray(result) ? result : [];
  return records
    .map(normalizeElement)
    .filter((element): element is StoredElement => element !== null && element.language === code)
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
    createdAt: Date.now(),
  };
  await putElement(created);
  return created;
}

export async function saveElement(element: StoredElement): Promise<StoredElement> {
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
  const saved: StoredElement = {
    id,
    language,
    title,
    equivalents: content.equivalents,
    definitions: content.definitions,
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
  await putElement(saved);
  return saved;
}

export async function deleteElement(id: string): Promise<void> {
  const key = id.trim();
  if (!key || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  await idbRequest(
    db.transaction(ELEMENTS_STORE, 'readwrite').objectStore(ELEMENTS_STORE).delete(key),
  );
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
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
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

const TRANSLATION_MARKER = /\[([a-z]{2}):\s*([^\]]*)]/gi;

export type PassageTranslation = {
  language: string;
  text: string;
};

export type ParsedPassage = {
  text: string;
  translations: PassageTranslation[];
};

/** Split `[en: …]` markers out of definition or example text for display. */
export function parsePassage(value: string): ParsedPassage {
  const translations: PassageTranslation[] = [];
  const text = value
    .replace(TRANSLATION_MARKER, (_match, language: string, body: string) => {
      const translation = body.trim();
      if (translation) translations.push({ language: language.toLowerCase(), text: translation });
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, translations };
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

function normalizeForms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const form = raw.trim();
    if (!form || seen.has(form)) continue;
    seen.add(form);
    forms.push(form);
  }
  return forms;
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
}
