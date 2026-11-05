import { signal } from '@angular/core';
import type { ElementMode } from 'collection';
import { normalizeStepGoal } from './step-goal';

const PALETTE_KEY = 'lingogem.mode-palettes.v1';

export type ModePalette = {
  start: string;
  end: string;
};

/** Score 0 uses the start color. A full step goal uses the end color. */
export const DEFAULT_MODE_PALETTES: Record<ElementMode, ModePalette> = {
  1: { start: '#e23b3b', end: '#f5a142' },
  2: { start: '#f5a142', end: '#6ec8ff' },
  3: { start: '#6ec8ff', end: '#3dcc78' },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MODES: readonly ElementMode[] = [1, 2, 3];

const revision = signal(0);

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizePaletteColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

function readStored(): Record<ElementMode, ModePalette> {
  const palettes: Record<ElementMode, ModePalette> = {
    1: { ...DEFAULT_MODE_PALETTES[1] },
    2: { ...DEFAULT_MODE_PALETTES[2] },
    3: { ...DEFAULT_MODE_PALETTES[3] },
  };
  if (typeof localStorage === 'undefined') return palettes;
  try {
    const parsed = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return palettes;
    const source = parsed as Record<string, unknown>;
    for (const mode of MODES) {
      const entry = source[String(mode)];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const start = sanitizePaletteColor(record['start']);
      const end = sanitizePaletteColor(record['end']);
      if (start) palettes[mode].start = start;
      if (end) palettes[mode].end = end;
    }
  } catch {
    return palettes;
  }
  return palettes;
}

/** Start and end colors for Sieving, Pickaxing, and Drilling. Later edits are watched. */
export function readModePalettes(): Record<ElementMode, ModePalette> {
  revision();
  return readStored();
}

export function writeModePalette(mode: ElementMode, edge: 'start' | 'end', value: unknown): void {
  const color = sanitizePaletteColor(value);
  if (!color || typeof localStorage === 'undefined') return;
  const palettes = readStored();
  if (palettes[mode][edge] === color) return;
  palettes[mode] = { ...palettes[mode], [edge]: color };
  persist(palettes);
}

/** Restores the three default ranges. */
export function resetModePalettes(): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(PALETTE_KEY) == null) return;
  localStorage.removeItem(PALETTE_KEY);
  revision.update((current) => current + 1);
}

function persist(palettes: Record<ElementMode, ModePalette>): void {
  const stored: Partial<Record<string, ModePalette>> = {};
  for (const mode of MODES) {
    const fallback = DEFAULT_MODE_PALETTES[mode];
    const palette = palettes[mode];
    if (palette.start === fallback.start && palette.end === fallback.end) continue;
    stored[String(mode)] = { start: palette.start, end: palette.end };
  }
  if (Object.keys(stored).length) localStorage.setItem(PALETTE_KEY, JSON.stringify(stored));
  else localStorage.removeItem(PALETTE_KEY);
  revision.update((current) => current + 1);
}

export type ScoreColor = {
  color: string;
  rgb: string;
};

/** The color at this score, from the mode's start color up to its end color. */
export function scoreColor(mode: ElementMode, succeeded: unknown, goal: unknown): ScoreColor {
  const palette = readModePalettes()[mode];
  const total = normalizeStepGoal(goal);
  const value = Math.round(Number(succeeded));
  const count = Number.isInteger(value) && value > 0 ? value : 0;
  const shown = Math.min(total, count);
  return mixHex(palette.start, palette.end, shown / total);
}

function mixHex(start: string, end: string, amount: number): ScoreColor {
  const from = channels(start);
  const to = channels(end);
  const mixed = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
  const [r, g, b] = mixed;
  return {
    color: `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`,
    rgb: `${r}, ${g}, ${b}`,
  };
}

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
