import { signal } from '@angular/core';

const PALETTE_KEY = 'lingogem.comfort-palette.v1';

export const COMFORT_RATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type ComfortRate = (typeof COMFORT_RATES)[number];

/** Rate 1 is the first color. Rate 10 is the last. */
export const DEFAULT_COMFORT_PALETTE: Record<ComfortRate, string> = {
  1: '#e23b3b',
  2: '#d04b42',
  3: '#bd5b49',
  4: '#ab6b4f',
  5: '#997b56',
  6: '#868c5d',
  7: '#749c64',
  8: '#62ac6a',
  9: '#4fbc71',
  10: '#3dcc78',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const revision = signal(0);

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizePaletteColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

function readStored(): Record<ComfortRate, string> {
  const palette: Record<ComfortRate, string> = { ...DEFAULT_COMFORT_PALETTE };
  if (typeof localStorage === 'undefined') return palette;
  try {
    const parsed = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return palette;
    const source = parsed as Record<string, unknown>;
    for (const rate of COMFORT_RATES) {
      const color = sanitizePaletteColor(source[String(rate)]);
      if (color) palette[rate] = color;
    }
  } catch {
    return palette;
  }
  return palette;
}

/** The ten comfort colors. Later edits are watched. */
export function readComfortPalette(): Record<ComfortRate, string> {
  revision();
  return readStored();
}

export function writeComfortColor(rate: ComfortRate, value: unknown): void {
  const color = sanitizePaletteColor(value);
  if (!color || typeof localStorage === 'undefined') return;
  const palette = readStored();
  if (palette[rate] === color) return;
  palette[rate] = color;
  persist(palette);
}

/** Restores the ten default colors. */
export function resetComfortPalette(): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(PALETTE_KEY) == null) return;
  localStorage.removeItem(PALETTE_KEY);
  revision.update((current) => current + 1);
}

function persist(palette: Record<ComfortRate, string>): void {
  const stored: Partial<Record<string, string>> = {};
  for (const rate of COMFORT_RATES) {
    const color = palette[rate];
    if (color === DEFAULT_COMFORT_PALETTE[rate]) continue;
    stored[String(rate)] = color;
  }
  if (Object.keys(stored).length) localStorage.setItem(PALETTE_KEY, JSON.stringify(stored));
  else localStorage.removeItem(PALETTE_KEY);
  revision.update((current) => current + 1);
}

/** The color for this comfort rate. Missing or out-of-range rates use rate 1. */
export function comfortColor(rate: unknown): string {
  const palette = readComfortPalette();
  const value = Math.round(Number(rate));
  const index = COMFORT_RATES.find((item) => item === value);
  return palette[index ?? 1];
}
