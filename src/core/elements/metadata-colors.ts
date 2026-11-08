import { signal } from '@angular/core';
import { sanitizePaletteColor } from './comfort-palette';

const STORAGE_KEY = 'lingogem.metadata-colors.v1';

export type MetadataColorPlace = 'definitions' | 'examples' | 'forms';

const PLACES: readonly MetadataColorPlace[] = ['definitions', 'examples', 'forms'];

type PlaceColors = Record<string, string>;

type LanguageColors = Partial<Record<MetadataColorPlace, PlaceColors>>;

type ColorStore = Record<string, LanguageColors>;

const revision = signal(0);

/** Color set on a metadata field. Values do not have their own color. */
export function readFieldColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
): string | null {
  revision();
  const name = key.trim();
  if (!name) return null;
  return readStore()[language.trim().toLowerCase()]?.[place]?.[name] ?? null;
}

/** Sets or clears the color for a metadata field. */
export function writeFieldColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
  value: unknown,
): void {
  const color = value === null ? null : sanitizePaletteColor(value);
  if (value !== null && !color) return;
  const code = language.trim().toLowerCase();
  const name = key.trim();
  if (!code || !name || reserved(name) || typeof localStorage === 'undefined') return;
  const store = readStore();
  const languageColors: LanguageColors = { ...(store[code] ?? {}) };
  const placeColors: PlaceColors = { ...(languageColors[place] ?? {}) };
  if (color) {
    if (placeColors[name] === color) return;
    placeColors[name] = color;
  } else if (!placeColors[name]) {
    return;
  } else {
    delete placeColors[name];
  }
  if (Object.keys(placeColors).length) languageColors[place] = placeColors;
  else delete languageColors[place];
  if (Object.keys(languageColors).length) store[code] = languageColors;
  else delete store[code];
  writeStore(store);
}

function readStore(): ColorStore {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: ColorStore = {};
    for (const [code, value] of Object.entries(parsed)) {
      const language = code.trim().toLowerCase();
      if (!language || reserved(language)) continue;
      const colors = readLanguage(value);
      if (colors) store[language] = colors;
    }
    return store;
  } catch {
    return {};
  }
}

function readLanguage(value: unknown): LanguageColors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const colors: LanguageColors = {};
  for (const place of PLACES) {
    const fields = readPlace(record[place]);
    if (fields) colors[place] = fields;
  }
  return Object.keys(colors).length ? colors : null;
}

function readPlace(value: unknown): PlaceColors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields: PlaceColors = {};
  for (const [rawKey, rawField] of Object.entries(value)) {
    const key = rawKey.trim();
    const color = readColor(rawField);
    if (!key || reserved(key) || !color) continue;
    fields[key] = color;
  }
  return Object.keys(fields).length ? fields : null;
}

function readColor(value: unknown): string | null {
  if (typeof value === 'string') return sanitizePaletteColor(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return sanitizePaletteColor((value as { color?: unknown }).color);
}

function writeStore(store: ColorStore): void {
  if (typeof localStorage === 'undefined') return;
  if (Object.keys(store).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  else localStorage.removeItem(STORAGE_KEY);
  revision.update((current) => current + 1);
}

function reserved(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
