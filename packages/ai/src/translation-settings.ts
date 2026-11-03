import {
  readDefinitionTranslations,
  readExampleTranslations,
  writeDefinitionTranslations,
  writeExampleTranslations,
} from './metadata-fields';

/** English when this language should come back with a translation. */
export function translationLanguage(language: string, enabled: boolean): string {
  const code = language.trim().toLowerCase();
  if (!enabled || !code || code === 'en') return '';
  return 'English';
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
