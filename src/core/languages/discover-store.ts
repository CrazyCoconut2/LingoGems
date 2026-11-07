import {
  ELEMENT_SEARCH_MAX_LENGTH,
  normalizeMetadataVariability,
  type ElementMetadata,
  type ElementMetadataVariability,
} from 'collection';
import { MAX_DISCOVER_INSTRUCTION } from 'ai';

const STORAGE_KEY = 'lingogem.discover.v1';
const MAX_SEARCHES = 20;
const MAX_ELEMENTS = 100;
const META_KEY_MAX = 40;
const META_VALUE_MAX = 100;
const SENSE_MAX = 2000;

export type DiscoverSense = {
  text: string;
  metadata: ElementMetadata;
};

export type DiscoverHit = {
  title: string;
  senses: DiscoverSense[];
};

export type DiscoverSearch = {
  id: string;
  instruction: string;
  definition: ElementMetadataVariability;
  example: ElementMetadataVariability;
  form: ElementMetadataVariability;
  elements: DiscoverHit[];
  updatedAt: number;
};

type DiscoverQuery = Pick<DiscoverSearch, 'instruction' | 'definition' | 'example' | 'form'>;

export function readDiscoverSearches(language: string): DiscoverSearch[] {
  const code = language.trim().toLowerCase();
  if (!code) return [];
  return readAll()[code] ?? [];
}

/** Insert or replace one search, newest first, and return that language's list. */
export function rememberDiscoverSearch(language: string, search: DiscoverSearch): DiscoverSearch[] {
  const code = language.trim().toLowerCase();
  const next = readSearch(search);
  if (!code || !next) return readDiscoverSearches(language);
  const all = readAll();
  const current = all[code] ?? [];
  const searches = [next, ...current.filter((item) => item.id !== next.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SEARCHES);
  all[code] = searches;
  writeAll(all);
  return searches;
}

export function discoverQueryMatches(search: DiscoverQuery, query: DiscoverQuery): boolean {
  return (
    search.instruction.trim() === query.instruction.trim() &&
    canonical(search.definition) === canonical(query.definition) &&
    canonical(search.example) === canonical(query.example) &&
    canonical(search.form) === canonical(query.form)
  );
}

function canonical(value: ElementMetadataVariability): string {
  const normalized = normalizeMetadataVariability(value);
  return JSON.stringify(
    Object.keys(normalized)
      .sort()
      .map((key) => [key, [...normalized[key]].sort()]),
  );
}

function readAll(): Record<string, DiscoverSearch[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored: Record<string, DiscoverSearch[]> = {};
    for (const [language, value] of Object.entries(parsed)) {
      const code = language.trim().toLowerCase();
      if (!code || !Array.isArray(value)) continue;
      const searches = value
        .map(readSearch)
        .filter((item): item is DiscoverSearch => item !== null)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_SEARCHES);
      if (searches.length) stored[code] = searches;
    }
    return stored;
  } catch {
    return {};
  }
}

function writeAll(stored: Record<string, DiscoverSearch[]>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!Object.keys(stored).length) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A full store should not hide the batch that was just found.
  }
}

function readSearch(raw: unknown): DiscoverSearch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<DiscoverSearch>;
  const id = String(record.id ?? '').trim();
  if (!id) return null;
  const elements = Array.isArray(record.elements)
    ? record.elements
        .map(readHit)
        .filter((item): item is DiscoverHit => item !== null)
        .slice(-MAX_ELEMENTS)
    : [];
  if (!elements.length) return null;
  const updatedAt = record.updatedAt;
  return {
    id,
    instruction: String(record.instruction ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DISCOVER_INSTRUCTION),
    definition: normalizeMetadataVariability(record.definition),
    example: normalizeMetadataVariability(record.example),
    form: normalizeMetadataVariability(record.form),
    elements,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function readHit(raw: unknown): DiscoverHit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as { title?: unknown; senses?: unknown };
  const title = String(record.title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ELEMENT_SEARCH_MAX_LENGTH);
  if (!title || !Array.isArray(record.senses)) return null;
  const senses = record.senses
    .map(readSense)
    .filter((item): item is DiscoverSense => item !== null);
  if (!senses.length) return null;
  return { title, senses };
}

function readSense(raw: unknown): DiscoverSense | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as { text?: unknown; metadata?: unknown };
  const text = String(record.text ?? '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, SENSE_MAX);
  if (!text) return null;
  return { text, metadata: readMetadata(record.metadata) };
}

function readMetadata(raw: unknown): ElementMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const metadata: ElementMetadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    const name = key.replace(/\s+/g, ' ').trim().slice(0, META_KEY_MAX);
    const text = value.trim().slice(0, META_VALUE_MAX);
    if (!name || !text) continue;
    metadata[name] = text;
  }
  return metadata;
}
