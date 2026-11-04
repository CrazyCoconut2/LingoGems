import { signal } from '@angular/core';

const BLUR_TRANSLATIONS_KEY = 'lingogem.blur-translations.v1';
const LEGACY_BLUR_TRANSLATIONS_KEY = 'lingogem.blur-translations';

if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_BLUR_TRANSLATIONS_KEY);

const revision = signal(0);

function languageCode(language: string): string {
  return language.trim().toLowerCase();
}

function readMap(): Record<string, false> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(BLUR_TRANSLATIONS_KEY) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, false> = {};
    for (const [code, value] of Object.entries(parsed)) {
      const key = languageCode(code);
      if (key && value === false) map[key] = false;
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, false>): void {
  if (typeof localStorage === 'undefined') return;
  if (Object.keys(map).length) localStorage.setItem(BLUR_TRANSLATIONS_KEY, JSON.stringify(map));
  else localStorage.removeItem(BLUR_TRANSLATIONS_KEY);
  revision.update((value) => value + 1);
}

/** Missing means the translations for this language stay blurred. */
export function readBlurTranslations(language: string): boolean {
  const code = languageCode(language);
  if (!code) return true;
  return readMap()[code] !== false;
}

/** Same value, and it updates open translations when the language setting changes. */
export function blurTranslationsEnabled(language: string): boolean {
  revision();
  return readBlurTranslations(language);
}

export function writeBlurTranslations(language: string, enabled: boolean): void {
  const code = languageCode(language);
  if (!code) return;
  const map = readMap();
  if (enabled) delete map[code];
  else map[code] = false;
  writeMap(map);
}
