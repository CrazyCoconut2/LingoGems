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

/** Stored color, or the score color when none was chosen. */
export function resolveHighlightColor(stored: unknown, score: number): string {
  return sanitizeHighlightColor(stored) ?? comfortColorHex(normalizeScore(score));
}

/** Stored style, or solid. */
export function resolveHighlightStyle(stored: unknown): HighlightStyle {
  return sanitizeHighlightStyle(stored) ?? 'solid';
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
