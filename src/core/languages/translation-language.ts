import { signal } from '@angular/core';
import { isLearnableLanguage } from 'collection';

const TRANSLATION_LANGUAGE_KEY = 'lingogem.translation-language';

function storedTranslationInto(): string {
  if (typeof localStorage === 'undefined') return '';
  const code = localStorage.getItem(TRANSLATION_LANGUAGE_KEY)?.trim().toLowerCase() ?? '';
  return isLearnableLanguage(code) ? code : '';
}

/** The translation language last chosen on this device. Empty means no translation. */
export const translationInto = signal(storedTranslationInto());

/** Remember the language code, or clear it when the choice is no translation. */
export function rememberTranslationInto(value: string): void {
  const code = value.trim().toLowerCase();
  const next = isLearnableLanguage(code) ? code : '';
  translationInto.set(next);
  if (typeof localStorage === 'undefined') return;
  if (!next) localStorage.removeItem(TRANSLATION_LANGUAGE_KEY);
  else localStorage.setItem(TRANSLATION_LANGUAGE_KEY, next);
}
