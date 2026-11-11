import { isLearnableLanguage, type LearnableLanguage } from 'collection';

const SELECTED_LANGUAGE_KEY = 'lingogem.selected-language';

/** Browser tags that name a learnable language under a different code. */
const BROWSER_LANGUAGE_ALIASES: Record<string, LearnableLanguage> = {
  nb: 'no',
  nn: 'no',
};

export function readSelectedLanguage(): LearnableLanguage | null {
  if (typeof localStorage === 'undefined') return null;
  const code = localStorage.getItem(SELECTED_LANGUAGE_KEY)?.trim().toLowerCase() ?? '';
  return isLearnableLanguage(code) ? code : null;
}

/** The first learnable language among the browser's preferred tags. */
export function browserLearnableLanguage(): LearnableLanguage | null {
  if (typeof navigator === 'undefined') return null;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const match = learnableFromBrowserTag(tag);
    if (match) return match;
  }
  return null;
}

/**
 * The stored filter language, or the browser language the first time.
 * A later manual choice stays put.
 */
export function ensureSelectedLanguage(): LearnableLanguage | null {
  const stored = readSelectedLanguage();
  if (stored) return stored;
  const browser = browserLearnableLanguage();
  if (!browser) return null;
  writeSelectedLanguage(browser);
  return browser;
}

function learnableFromBrowserTag(tag: string): LearnableLanguage | null {
  const normalized = tag.trim().toLowerCase().replaceAll('_', '-');
  if (!normalized) return null;
  if (isLearnableLanguage(normalized)) return normalized;
  const primary = normalized.split('-')[0] ?? '';
  return BROWSER_LANGUAGE_ALIASES[primary] ?? (isLearnableLanguage(primary) ? primary : null);
}

export function writeSelectedLanguage(code: LearnableLanguage): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SELECTED_LANGUAGE_KEY, code);
}
