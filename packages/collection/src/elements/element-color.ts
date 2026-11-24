const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizeElementColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

/** Unique colors in first-seen order. Invalid values are left out. */
export function normalizeElementColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const colors: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const color = sanitizeElementColor(item);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    colors.push(color);
  }
  return colors;
}

/** Adds colors from `extra` that are not already present. Existing order stays. */
export function mergeElementColors(base: readonly string[], extra: readonly unknown[]): string[] {
  return normalizeElementColors([...base, ...extra]);
}
