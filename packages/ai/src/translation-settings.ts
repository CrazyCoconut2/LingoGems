import { languageDisplayName } from 'collection';
import {
  readDefinitionTranslations,
  readExampleTranslations,
  readStoredTranslationLanguage,
  writeDefinitionTranslations,
  writeExampleTranslations,
  writeStoredTranslationLanguage,
} from './metadata-fields';

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

export function readGenerateDefinitionTranslations(language: string): boolean {
  return readDefinitionTranslations(language);
}

export function readGenerateExampleTranslations(language: string): boolean {
  return readExampleTranslations(language);
}

export function writeGenerateDefinitionTranslations(language: string, enabled: boolean): void {
  writeDefinitionTranslations(language, enabled);
}

export function writeGenerateExampleTranslations(language: string, enabled: boolean): void {
  writeExampleTranslations(language, enabled);
}
