const KEY_PREFIX = 'lingogem.stats.missing.v1.';

/** Lowercase spellings hidden from the missing-word list. */
export function readMissingBlacklist(language: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  const key = missingKey(language);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return normalizeKeys(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Hide a spelling. Returns the list now stored for this language. */
export function ignoreMissingToken(language: string, token: string): string[] {
  const key = token.trim();
  const current = readMissingBlacklist(language);
  if (!key || current.includes(key)) return current;
  const next = [...current, key];
  writeMissingBlacklist(language, next);
  return next;
}

/** Show a spelling again. Returns the list now stored for this language. */
export function restoreMissingToken(language: string, token: string): string[] {
  const key = token.trim();
  const next = readMissingBlacklist(language).filter((item) => item !== key);
  writeMissingBlacklist(language, next);
  return next;
}

function writeMissingBlacklist(language: string, keys: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  const storageKey = missingKey(language);
  if (!storageKey) return;
  try {
    if (!keys.length) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // The in-memory list still applies for this visit.
  }
}

function missingKey(language: string): string {
  const code = language.trim().toLowerCase();
  return code ? KEY_PREFIX + code : '';
}

function normalizeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
