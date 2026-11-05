import { signal } from '@angular/core';
import {
  definitionGemFallbackName,
  emptyGemMeanings,
  normalizeDefinitionGem,
  normalizeGemMeanings,
  type DefinitionGem,
  type GemMeanings,
} from 'collection';

const LEGACY_GEM_MEANINGS_KEY = 'lingogem.gem-meanings.v1';

const remembered = signal<Record<string, GemMeanings>>({});

function languageKey(code: string): string {
  return code.trim().toLowerCase();
}

/** Keeps this language's stone meanings available to the open pages. */
export function rememberGemMeanings(code: string, meanings: GemMeanings): void {
  const key = languageKey(code);
  if (!key) return;
  remembered.update((current) => ({ ...current, [key]: normalizeGemMeanings(meanings) }));
}

function meaningsFor(code: string): GemMeanings {
  return remembered()[languageKey(code)] ?? emptyGemMeanings();
}

/** The text in the settings field, including a trailing space while it is being typed. */
export function gemMeaningDraft(code: string, gem: DefinitionGem): string {
  return meaningsFor(code)[normalizeDefinitionGem(gem)];
}

export function gemMeaning(code: string, gem: DefinitionGem): string {
  return gemMeaningDraft(code, gem).replace(/\s+/g, ' ').trim();
}

/** The meaning when one is set, otherwise "Gem 1" and so on. */
export function gemAccessibleName(code: string, gem: DefinitionGem): string {
  return gemMeaning(code, gem) || definitionGemFallbackName(gem);
}

/**
 * Meanings saved before they belonged to a language.
 * Reading them removes the old copy so only the first language to ask receives them.
 */
export function takeLegacyGemMeanings(): GemMeanings | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LEGACY_GEM_MEANINGS_KEY);
  if (raw == null) return null;
  localStorage.removeItem(LEGACY_GEM_MEANINGS_KEY);
  const meanings = normalizeGemMeanings(parseLegacy(raw));
  return Object.values(meanings).some((text) => text.replace(/\s+/g, ' ').trim()) ? meanings : null;
}

function parseLegacy(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
