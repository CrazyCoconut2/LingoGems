import { languageDisplayName } from 'collection';
import { readStoredTranslationLanguage, writeStoredTranslationLanguage } from './metadata-fields';

/** The language translations are written in for this learning language. */
export function readTranslationLanguage(language: string): string {
  return readStoredTranslationLanguage(language);
}

/** Saves the translation language for this learning language. English clears it. */
export function writeTranslationLanguage(language: string, value: unknown): void {
  writeStoredTranslationLanguage(language, value);
}

/** The translation language's name when this language should come back with one. */
export function translationLanguage(language: string, enabled: boolean): string {
  const target = readTranslationLanguage(language);
  const code = language.trim().toLowerCase();
  if (!enabled || !code || code === target) return '';
  return languageDisplayName(target) || target;
}
