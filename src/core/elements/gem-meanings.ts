import { signal } from '@angular/core';
import {
  DEFINITION_GEMS,
  definitionGemFallbackName,
  normalizeDefinitionGem,
  type DefinitionGem,
} from 'collection';

const GEM_MEANINGS_KEY = 'lingogem.gem-meanings.v1';

export const GEM_MEANING_MAX_LENGTH = 40;

const revision = signal(0);

function emptyMeanings(): Record<DefinitionGem, string> {
  return {
    'gem-1': '',
    'gem-2': '',
    'gem-3': '',
    'gem-4': '',
    'gem-5': '',
  };
}

function readStored(): Record<DefinitionGem, string> {
  const meanings = emptyMeanings();
  if (typeof localStorage === 'undefined') return meanings;
  try {
    const parsed = JSON.parse(localStorage.getItem(GEM_MEANINGS_KEY) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return meanings;
    const source = parsed as Record<string, unknown>;
    for (const gem of DEFINITION_GEMS) {
      const value = source[gem];
      if (typeof value !== 'string') continue;
      meanings[gem] = value.slice(0, GEM_MEANING_MAX_LENGTH);
    }
  } catch {
    return meanings;
  }
  return meanings;
}

/** Optional meaning for each stone. An empty string means the stone is unlabeled. Later edits are watched. */
export function readGemMeanings(): Record<DefinitionGem, string> {
  revision();
  return readStored();
}

/** The text in the settings field, including a trailing space while it is being typed. */
export function gemMeaningDraft(gem: DefinitionGem): string {
  return readGemMeanings()[normalizeDefinitionGem(gem)];
}

export function gemMeaning(gem: DefinitionGem): string {
  return gemMeaningDraft(gem).replace(/\s+/g, ' ').trim();
}

/** The meaning when one is set, otherwise "Gem 1" and so on. */
export function gemAccessibleName(gem: DefinitionGem): string {
  const meaning = gemMeaning(gem);
  return meaning || definitionGemFallbackName(gem);
}

export function writeGemMeaning(gem: DefinitionGem, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  const id = normalizeDefinitionGem(gem);
  const text =
    typeof value === 'string' ? value.replace(/\r?\n/g, ' ').slice(0, GEM_MEANING_MAX_LENGTH) : '';
  const meanings = readStored();
  if (meanings[id] === text) return;
  meanings[id] = text;
  const stored: Record<string, string> = {};
  for (const item of DEFINITION_GEMS) {
    if (meanings[item].replace(/\s+/g, ' ').trim()) stored[item] = meanings[item];
  }
  if (Object.keys(stored).length) localStorage.setItem(GEM_MEANINGS_KEY, JSON.stringify(stored));
  else localStorage.removeItem(GEM_MEANINGS_KEY);
  revision.update((current) => current + 1);
}
