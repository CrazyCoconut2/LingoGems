export const HIGHLIGHT_STYLES = ['solid', 'dashed', 'dotted', 'wavy'] as const;

export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

export const DEFAULT_HIGHLIGHT_COLOR = '#6c63ff';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const STYLE_SET = new Set<string>(HIGHLIGHT_STYLES);

/** Integer 1–10. Anything else is 1. */
export function normalizeScore(value: unknown): number {
  const score = Math.round(Number(value));
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : 1;
}

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizeHighlightColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

/** Underline style, or null when missing or invalid. */
export function sanitizeHighlightStyle(value: unknown): HighlightStyle | null {
  if (typeof value !== 'string') return null;
  const style = value.trim().toLowerCase();
  return STYLE_SET.has(style) ? (style as HighlightStyle) : null;
}

/** Red at 1, green at 10. */
export function comfortColor(level: number): string {
  return `hsl(${comfortHue(level)}, 70%, 62%)`;
}

export function comfortChipBg(level: number): string {
  return `hsla(${comfortHue(level)}, 70%, 62%, 0.14)`;
}

/** Same scale as `comfortColor`, as `#rrggbb`. */
export function comfortColorHex(level: number): string {
  return hslToHex(comfortHue(level), 70, 62);
}

const SCORE_COLORS_KEY = 'lingogem.score-colors';
const SCORE_COUNT = 10;

let scoreColorOverrides = readStoredScoreColors();

/** Saved color for one score, or null when it still uses the default. */
export function scoreColorOverride(level: number): string | null {
  return scoreColorOverrides[normalizeScore(level) - 1] ?? null;
}

/** The ten saved colors, with null where a score still uses its default. */
export function readScoreColorOverrides(): Array<string | null> {
  return scoreColorOverrides.slice();
}

/** Saved color, or the default comfort color for that score. */
export function scoreColorHex(level: number): string {
  const score = normalizeScore(level);
  return scoreColorOverrides[score - 1] ?? comfortColorHex(score);
}

/** Soft tint of the score color, for the score steps. */
export function scoreChipBg(level: number): string {
  return `${scoreColorHex(level)}24`;
}

/** Save one score color. Null restores the default. The default itself is not stored. */
export function writeScoreColor(level: number, color: string | null): void {
  const score = normalizeScore(level);
  const next = scoreColorOverrides.slice();
  if (color == null) {
    next[score - 1] = null;
  } else {
    const hex = sanitizeHighlightColor(color);
    if (!hex) return;
    next[score - 1] = hex === comfortColorHex(score) ? null : hex;
  }
  scoreColorOverrides = next;
  persistScoreColors();
}

/** Restore every score to its default color. */
export function resetScoreColors(): void {
  if (scoreColorOverrides.every((color) => color == null)) return;
  scoreColorOverrides = Array.from({ length: SCORE_COUNT }, () => null);
  persistScoreColors();
}

/** Stored color, or the score color when none was chosen. */
export function resolveHighlightColor(stored: unknown, score: number): string {
  return sanitizeHighlightColor(stored) ?? scoreColorHex(score);
}

/** Stored style, or solid. */
export function resolveHighlightStyle(stored: unknown): HighlightStyle {
  return sanitizeHighlightStyle(stored) ?? 'solid';
}

function readStoredScoreColors(): Array<string | null> {
  const empty = (): Array<string | null> => Array.from({ length: SCORE_COUNT }, () => null);
  if (typeof localStorage === 'undefined') return empty();
  try {
    const raw = JSON.parse(localStorage.getItem(SCORE_COLORS_KEY) ?? 'null') as unknown;
    if (!Array.isArray(raw)) return empty();
    return Array.from({ length: SCORE_COUNT }, (_, index) => sanitizeHighlightColor(raw[index]));
  } catch {
    return empty();
  }
}

function persistScoreColors(): void {
  if (typeof localStorage === 'undefined') return;
  if (scoreColorOverrides.every((color) => color == null)) {
    localStorage.removeItem(SCORE_COLORS_KEY);
    return;
  }
  localStorage.setItem(SCORE_COLORS_KEY, JSON.stringify(scoreColorOverrides));
}

function comfortHue(level: number): number {
  const score = normalizeScore(level);
  return Math.round(((score - 1) / 9) * 120);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = chroma;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = chroma;
  } else if (hue < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
