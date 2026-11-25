const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb`, or null when missing or invalid. */
export function sanitizeElementColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}
