import { signal } from '@angular/core';
import { isLearnableLanguage } from 'collection';

const SUPPORT_LANGUAGE_KEY = 'lingogem.support-language';
const LEGACY_TRANSLATION_LANGUAGE_KEY = 'lingogem.translation-language';

export type SupportLanguageSettings = {
  /** Learnable code, or '' when there is no general support language. */
  general: string;
  /** Learning language to its support language. '' means none. A missing key uses the general one. */
  overrides: Record<string, string>;
};

function emptySettings(): SupportLanguageSettings {
  return { general: '', overrides: {} };
}

function languageCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isLearnableLanguage(code) ? code : '';
}

function readOverrides(source: unknown, general: string): Record<string, string> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const overrides: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source as Record<string, unknown>)) {
    if (key === 'general' || key === 'overrides') continue;
    const learning = key.trim().toLowerCase();
    if (!isLearnableLanguage(learning) || typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      if (general) overrides[learning] = '';
      continue;
    }
    if (!isLearnableLanguage(trimmed) || trimmed === learning || trimmed === general) continue;
    overrides[learning] = trimmed;
  }
  return overrides;
}

function normalize(value: unknown): SupportLanguageSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySettings();
  const record = value as { general?: unknown; overrides?: unknown };
  if ('general' in record || 'overrides' in record) {
    const general = languageCode(record.general);
    return { general, overrides: readOverrides(record.overrides, general) };
  }
  return { general: '', overrides: readOverrides(value, '') };
}

function readStored(): SupportLanguageSettings {
  if (typeof localStorage === 'undefined') return emptySettings();
  const raw = localStorage.getItem(SUPPORT_LANGUAGE_KEY);
  if (raw !== null) {
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return emptySettings();
    }
  }
  return migrateLegacy();
}

/** Copy a saved translation language into the general support language, once. */
function migrateLegacy(): SupportLanguageSettings {
  const legacy = localStorage.getItem(LEGACY_TRANSLATION_LANGUAGE_KEY);
  if (legacy === null) return emptySettings();
  localStorage.removeItem(LEGACY_TRANSLATION_LANGUAGE_KEY);
  const general = languageCode(legacy);
  const settings = { general, overrides: {} };
  if (general) localStorage.setItem(SUPPORT_LANGUAGE_KEY, JSON.stringify(settings));
  return settings;
}

function persist(settings: SupportLanguageSettings): void {
  const next = normalize(settings);
  supportSettings.set(next);
  if (typeof localStorage === 'undefined') return;
  if (!next.general && !Object.keys(next.overrides).length) {
    localStorage.removeItem(SUPPORT_LANGUAGE_KEY);
    return;
  }
  localStorage.setItem(SUPPORT_LANGUAGE_KEY, JSON.stringify(next));
}

/** The general support language, and any language that uses a different one. */
export const supportSettings = signal(readStored());

/** Support language for a learning language, or '' when that language has none. */
export function supportLanguageFor(learning: string): string {
  const code = learning.trim().toLowerCase();
  const settings = supportSettings();
  const chosen = Object.hasOwn(settings.overrides, code)
    ? settings.overrides[code]
    : settings.general;
  if (!code || !isLearnableLanguage(chosen) || chosen === code) return '';
  return chosen;
}

/** Set the support language used by every language without an override. */
export function writeGeneralSupportLanguage(value: string): void {
  persist({ general: languageCode(value), overrides: supportSettings().overrides });
}

/**
 * Set one language's support language.
 * A value equal to the general language clears the override. Empty means none.
 */
export function writeSupportLanguage(learning: string, into: string): void {
  const code = learning.trim().toLowerCase();
  if (!isLearnableLanguage(code)) return;
  const current = supportSettings();
  const overrides = { ...current.overrides };
  const target = into.trim().toLowerCase();
  if (target && !isLearnableLanguage(target)) return;
  if (target === code) return;
  if (target === current.general) delete overrides[code];
  else overrides[code] = target;
  persist({ general: current.general, overrides });
}
