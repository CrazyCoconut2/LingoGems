import { isLearnableLanguage, languageDisplayName } from 'collection';

/** Language code to translate into, or '' when it is missing or the same as the learning language. */
export function translationTarget(learning: string, target: string | null | undefined): string {
  const into = String(target ?? '').trim().toLowerCase();
  const from = learning.trim().toLowerCase();
  if (!isLearnableLanguage(into) || !from || from === into) return '';
  return into;
}

/** Display name of that language, or '' when there is nothing to translate into. */
export function translationLanguage(learning: string, target: string | null | undefined): string {
  const into = translationTarget(learning, target);
  return into ? languageDisplayName(into) || into : '';
}
