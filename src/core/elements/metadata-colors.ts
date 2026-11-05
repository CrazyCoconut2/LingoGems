import { signal } from '@angular/core';
import { sanitizePaletteColor } from './mode-palette';

const STORAGE_KEY = 'lingogem.metadata-colors.v1';

export type MetadataColorPlace = 'definitions' | 'examples' | 'forms';

const PLACES: readonly MetadataColorPlace[] = ['definitions', 'examples', 'forms'];

type FieldColors = {
  color?: string;
  values?: Record<string, string>;
};

type PlaceColors = Record<string, FieldColors>;

type LanguageColors = Partial<Record<MetadataColorPlace, PlaceColors>>;

type ColorStore = Record<string, LanguageColors>;

const revision = signal(0);

/** The value color, otherwise the field color, otherwise null. */
export function metadataChipColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
  value: string,
): string | null {
  revision();
  const field = fieldOf(readStore(), language, place, key);
  if (!field) return null;
  return valueOf(field, value) ?? field.color ?? null;
}

/** Color set on the whole field, ignoring value overrides. */
export function readFieldColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
): string | null {
  revision();
  return fieldOf(readStore(), language, place, key)?.color ?? null;
}

/** Color set on one value. A field color does not count. */
export function readValueColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
  value: string,
): string | null {
  revision();
  const field = fieldOf(readStore(), language, place, key);
  return field ? valueOf(field, value) : null;
}

/** Sets or clears the color for every value of a field. Value colors stay. */
export function writeFieldColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
  value: unknown,
): void {
  const color = value === null ? null : sanitizePaletteColor(value);
  if (value !== null && !color) return;
  updateField(language, place, key, (field) => {
    if (color) {
      if (field.color === color) return field;
      return { ...field, color };
    }
    if (!field.color) return field;
    const next = { ...field };
    delete next.color;
    return next;
  });
}

/** Sets or clears the color for one value. It replaces the field color for that value. */
export function writeValueColor(
  language: string,
  place: MetadataColorPlace,
  key: string,
  metadataValue: string,
  value: unknown,
): void {
  const text = metadataValue.trim();
  if (!text || reserved(text)) return;
  const color = value === null ? null : sanitizePaletteColor(value);
  if (value !== null && !color) return;
  updateField(language, place, key, (field) => {
    const values = { ...(field.values ?? {}) };
    if (color) {
      if (values[text] === color) return field;
      values[text] = color;
      return { ...field, values };
    }
    if (!values[text]) return field;
    delete values[text];
    const next = { ...field };
    if (Object.keys(values).length) next.values = values;
    else delete next.values;
    return next;
  });
}

function updateField(
  language: string,
  place: MetadataColorPlace,
  key: string,
  change: (field: FieldColors) => FieldColors,
): void {
  const code = language.trim().toLowerCase();
  const name = key.trim();
  if (!code || !name || reserved(name) || typeof localStorage === 'undefined') return;
  const store = readStore();
  const languageColors: LanguageColors = { ...(store[code] ?? {}) };
  const placeColors: PlaceColors = { ...(languageColors[place] ?? {}) };
  const current = placeColors[name] ?? {};
  const draft: FieldColors = { ...current };
  if (current.values) draft.values = { ...current.values };
  const next = pruneField(change(draft));
  if (sameField(current, next)) return;
  if (next) placeColors[name] = next;
  else delete placeColors[name];
  if (Object.keys(placeColors).length) languageColors[place] = placeColors;
  else delete languageColors[place];
  if (Object.keys(languageColors).length) store[code] = languageColors;
  else delete store[code];
  writeStore(store);
}

function fieldOf(
  store: ColorStore,
  language: string,
  place: MetadataColorPlace,
  key: string,
): FieldColors | null {
  const name = key.trim();
  if (!name) return null;
  return store[language.trim().toLowerCase()]?.[place]?.[name] ?? null;
}

function valueOf(field: FieldColors, value: string): string | null {
  const text = value.trim();
  if (!text || !field.values) return null;
  return field.values[text] ?? null;
}

function pruneField(field: FieldColors): FieldColors | null {
  const next: FieldColors = {};
  if (field.color) next.color = field.color;
  if (field.values && Object.keys(field.values).length) next.values = field.values;
  return next.color || next.values ? next : null;
}

function sameField(left: FieldColors, right: FieldColors | null): boolean {
  if (!right) return !left.color && !left.values;
  if (left.color !== right.color) return false;
  const leftValues = left.values ?? {};
  const rightValues = right.values ?? {};
  const leftKeys = Object.keys(leftValues);
  const rightKeys = Object.keys(rightValues);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => leftValues[key] === rightValues[key]);
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
    if (!key || reserved(key)) continue;
    const field = readField(rawField);
    if (field) fields[key] = field;
  }
  return Object.keys(fields).length ? fields : null;
}

function readField(value: unknown): FieldColors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { color?: unknown; values?: unknown };
  const field: FieldColors = {};
  const color = sanitizePaletteColor(record.color);
  if (color) field.color = color;
  if (record.values && typeof record.values === 'object' && !Array.isArray(record.values)) {
    const values: Record<string, string> = {};
    for (const [rawValue, rawColor] of Object.entries(record.values)) {
      const text = rawValue.trim();
      const swatch = sanitizePaletteColor(rawColor);
      if (!text || reserved(text) || !swatch) continue;
      values[text] = swatch;
    }
    if (Object.keys(values).length) field.values = values;
  }
  return field.color || field.values ? field : null;
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
