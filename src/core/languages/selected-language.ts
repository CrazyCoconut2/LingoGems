import { isLearnableLanguage, type LearnableLanguage } from 'collection';

const SELECTED_LANGUAGE_KEY = 'lingogem.selected-language';

export function readSelectedLanguage(): LearnableLanguage | null {
  if (typeof localStorage === 'undefined') return null;
  const code = localStorage.getItem(SELECTED_LANGUAGE_KEY)?.trim().toLowerCase() ?? '';
  return isLearnableLanguage(code) ? code : null;
}

export function writeSelectedLanguage(code: LearnableLanguage): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SELECTED_LANGUAGE_KEY, code);
}
