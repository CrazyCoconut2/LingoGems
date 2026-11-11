export const LEARNABLE_LANGUAGES = Object.freeze([
  'ar',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'tr',
  'zh',
] as const);

export type LearnableLanguage = (typeof LEARNABLE_LANGUAGES)[number];

const LANGUAGE_NATIVE_NAMES: Record<LearnableLanguage, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  cs: 'Čeština',
  nl: 'Nederlands',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
  ar: 'العربية',
  pl: 'Polski',
  sv: 'Svenska',
  da: 'Dansk',
  no: 'Norsk',
  fi: 'Suomi',
  el: 'Ελληνικά',
  tr: 'Türkçe',
  ko: '한국어',
  hi: 'हिन्दी',
};

export function isLearnableLanguage(code: string): code is LearnableLanguage {
  return (LEARNABLE_LANGUAGES as readonly string[]).includes(code.trim().toLowerCase());
}

export function languageDisplayName(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!isLearnableLanguage(normalized)) return normalized.toUpperCase();
  return LANGUAGE_NATIVE_NAMES[normalized];
}

/** A two-letter code or a language's own name, such as `en` or `English`. */
export function languageCodeFromLabel(label: string): LearnableLanguage | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const code = trimmed.toLowerCase();
  if (isLearnableLanguage(code)) return code;
  const folded = trimmed.toLocaleLowerCase();
  return (
    LEARNABLE_LANGUAGES.find(
      (item) => LANGUAGE_NATIVE_NAMES[item].toLocaleLowerCase() === folded,
    ) ?? null
  );
}
