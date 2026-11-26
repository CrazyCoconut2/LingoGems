export type LANGUAGE_CODE = 'en' | 'cs' | 'de' | 'es' | 'fr' | 'it' | 'pl' | 'pt';

/** App UI languages. */
export const SUPPORTED_LANGUAGES: LANGUAGE_CODE[] = [
  'en',
  'cs',
  'de',
  'es',
  'fr',
  'it',
  'pl',
  'pt',
];

/** Endonyms for the language picker. Not catalog strings. */
const LANGUAGE_NATIVE_NAMES: Record<LANGUAGE_CODE, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  cs: 'Čeština',
  pl: 'Polski',
};

export function getLanguageDisplayName(code: string): string {
  const normalized = code.trim().toLowerCase();
  return LANGUAGE_NATIVE_NAMES[normalized as LANGUAGE_CODE] ?? code.toUpperCase();
}

export function normalizeLanguageCode(langCode: string): LANGUAGE_CODE {
  const baseCode = langCode.split('-')[0].toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(baseCode as LANGUAGE_CODE)) {
    return baseCode as LANGUAGE_CODE;
  }
  return 'en';
}
