import { ELEMENTS_STORE, idbRequest, openDatabase } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from '../languages/catalog';

export type ElementMetadata = Record<string, string>;

export type ElementExample = {
  text: string;
  metadata: ElementMetadata;
};

export type ElementDefinition = {
  text: string;
  translation: string;
  equivalent: string;
  forms: string[];
  examples: ElementExample[];
  metadata: ElementMetadata;
};

export type StoredElement = {
  id: string;
  language: LearnableLanguage;
  title: string;
  definitions: ElementDefinition[];
  createdAt: number;
};

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
  const saved: StoredElement = {
    id,
    language,
    title,
    definitions: normalizeDefinitions(element?.definitions),
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
  return {
    id,
    language,
    title,
    definitions: normalizeDefinitions(source.definitions),
    createdAt:
      typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : 0,
  };
}

function normalizeDefinitions(value: unknown): ElementDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: ElementDefinition[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Partial<ElementDefinition>;
    const text = String(source.text ?? '').trim();
    if (!text) continue;
    definitions.push({
      text,
      translation: normalizePlainText(source.translation),
      equivalent: normalizePlainText(source.equivalent),
      forms: normalizeForms(source.forms),
      examples: normalizeExamples(source.examples),
      metadata: normalizeMetadata(source.metadata),
    });
  }
  return definitions;
}

function normalizePlainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    const text = String((raw as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    examples.push({
      text,
      metadata: normalizeMetadata((raw as { metadata?: unknown }).metadata),
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
