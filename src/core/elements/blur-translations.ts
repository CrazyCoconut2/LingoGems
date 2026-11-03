import { signal } from '@angular/core';

const BLUR_TRANSLATIONS_KEY = 'lingogem.blur-translations';

function readStored(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(BLUR_TRANSLATIONS_KEY) !== 'false';
}

/** Translations stay blurred until clicked, unless this is turned off. */
export const blurTranslations = signal(readStored());

export function writeBlurTranslations(enabled: boolean): void {
  blurTranslations.set(enabled);
  if (typeof localStorage === 'undefined') return;
  if (enabled) localStorage.removeItem(BLUR_TRANSLATIONS_KEY);
  else localStorage.setItem(BLUR_TRANSLATIONS_KEY, 'false');
}
