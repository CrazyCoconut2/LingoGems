export const HIGHLIGHT_STYLES = ['solid', 'dashed', 'dotted', 'wavy'] as const;

export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

const STYLE_SET = new Set<string>(HIGHLIGHT_STYLES);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

/** Stored style, or solid. */
export function resolveHighlightStyle(stored: unknown): HighlightStyle {
  return sanitizeHighlightStyle(stored) ?? 'solid';
}
