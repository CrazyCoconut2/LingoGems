/** The five colors an element can take without becoming a custom color. */
export const ELEMENT_COLOR_PRESETS = [
  '#cf7b6e',
  '#cfc86e',
  '#71cf6e',
  '#6ecfbb',
  '#7aa0cf',
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizeElementColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

export function isPresetElementColor(color: string): boolean {
  return (ELEMENT_COLOR_PRESETS as readonly string[]).includes(color);
}

/** A saved color outside the five presets. Presets and invalid values are null. */
export function customElementColor(value: unknown): string | null {
  const color = sanitizeElementColor(value);
  if (!color || isPresetElementColor(color)) return null;
  return color;
}

/** Unique custom colors, sorted. Presets are left out. */
export function normalizeElementColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const colors = new Set<string>();
  for (const item of value) {
    const color = customElementColor(item);
    if (color) colors.add(color);
  }
  return [...colors].sort();
}

/** Adds custom colors from `extra`. Colors already present stay. */
export function mergeElementColors(base: readonly string[], extra: readonly unknown[]): string[] {
  return normalizeElementColors([...base, ...extra]);
}
