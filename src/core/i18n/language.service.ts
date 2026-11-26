import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { LANGUAGE_CODE, SUPPORTED_LANGUAGES, normalizeLanguageCode } from './language-code';

// Locale JSON is imported here so the build rebuilds this module when catalogs change.
import enTranslations from './en.json';
import csTranslations from './cs.json';
import deTranslations from './de.json';
import esTranslations from './es.json';
import frTranslations from './fr.json';
import itTranslations from './it.json';
import plTranslations from './pl.json';
import ptTranslations from './pt.json';

interface Translation {
  [key: string]: string;
}

const APP_LANGUAGE_STORAGE_KEY = 'linguagem.appLanguage';

const TRANSLATIONS: Record<LANGUAGE_CODE, Translation> = {
  en: enTranslations as Translation,
  cs: csTranslations as Translation,
  de: deTranslations as Translation,
  es: esTranslations as Translation,
  fr: frTranslations as Translation,
  it: itTranslations as Translation,
  pl: plTranslations as Translation,
  pt: ptTranslations as Translation,
};

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private readonly fallbackLanguage: LANGUAGE_CODE = 'en';
  private readonly supportedLanguages = new Set<LANGUAGE_CODE>(SUPPORTED_LANGUAGES);
  private readonly languageChangedSubject = new Subject<LANGUAGE_CODE>();
  readonly languageChanged$ = this.languageChangedSubject.asObservable();

  private _currentLanguage: LANGUAGE_CODE;
  private _hasUserOverride = false;

  constructor() {
    const storedLanguage = this.readStoredLanguage();
    if (storedLanguage) {
      this._currentLanguage = storedLanguage;
      this._hasUserOverride = true;
    } else {
      this._currentLanguage = this.resolveNavigatorLanguage();
    }
    this.updateDocumentLanguage(this._currentLanguage);
  }

  get currentLanguage(): LANGUAGE_CODE {
    return this._currentLanguage;
  }

  get hasUserOverride(): boolean {
    return this._hasUserOverride;
  }

  setAppLanguage(language: LANGUAGE_CODE): void {
    if (!this.isSupportedLanguage(language)) return;
    this._hasUserOverride = true;
    this.applyLanguage(language, { persist: true });
    this.languageChangedSubject.next(this._currentLanguage);
  }

  resetAppLanguage(): void {
    this._hasUserOverride = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(APP_LANGUAGE_STORAGE_KEY);
    }
    this.applyLanguage(this.resolveNavigatorLanguage(), { persist: false });
    this.languageChangedSubject.next(this._currentLanguage);
  }

  translate(key: string, params?: Record<string, string>): string {
    return this.translateIn(this._currentLanguage, key, params);
  }

  /**
   * Translate into a specific language catalog.
   * Unsupported codes fall back to the app UI language, then English, then the key.
   */
  translateIn(language: string, key: string, params?: Record<string, string>): string {
    const base = String(language || '')
      .split('-')[0]
      .toLowerCase();
    const catalog = this.isSupportedLanguage(base) ? base : this._currentLanguage;
    const translation =
      TRANSLATIONS[catalog]?.[key] ??
      TRANSLATIONS[this._currentLanguage]?.[key] ??
      TRANSLATIONS[this.fallbackLanguage]?.[key] ??
      key;

    if (!params) return translation;

    let result = translation;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      result = result.replaceAll(`{${paramKey}}`, paramValue);
    }
    return result;
  }

  private applyLanguage(language: LANGUAGE_CODE, options: { persist: boolean }): void {
    this._currentLanguage = language;
    this.updateDocumentLanguage(language);
    if (options.persist && typeof localStorage !== 'undefined') {
      localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
    }
  }

  private readStoredLanguage(): LANGUAGE_CODE | null {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
    if (!stored || !this.isSupportedLanguage(stored)) return null;
    return stored;
  }

  private resolveNavigatorLanguage(): LANGUAGE_CODE {
    if (typeof navigator === 'undefined') return this.fallbackLanguage;
    const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
    for (const candidate of candidates) {
      const normalized = normalizeLanguageCode(candidate);
      if (this.isSupportedLanguage(normalized)) return normalized;
    }
    return this.fallbackLanguage;
  }

  private updateDocumentLanguage(language: LANGUAGE_CODE): void {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }

  private isSupportedLanguage(language: string): language is LANGUAGE_CODE {
    return this.supportedLanguages.has(language as LANGUAGE_CODE);
  }
}
