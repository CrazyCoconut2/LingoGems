import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  assignEquivalent,
  DEFAULT_HIGHLIGHT_COLOR,
  definitionFrequencyLabel,
  DEFINITION_FREQUENCIES,
  deleteElement,
  displayTitle,
  embedTranslation,
  elementModeLabel,
  type ElementMode,
  formTexts,
  HIGHLIGHT_STYLES,
  highlightDefinitionPassage,
  isValidForm,
  normalizeDefinitionFrequency,
  parsePassage,
  resolveHighlightColor,
  resolveHighlightStyle,
  sanitizeHighlightColor,
  saveElement,
  type DefinitionFrequency,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementEquivalent,
  type ElementMetadata,
  type HighlightStyle,
  type PassageTranslation,
  type StoredElement,
} from 'collection';
import {
  MAX_DEFINITION_INSTRUCTION,
  MAX_EXAMPLE_INSTRUCTION,
  MAX_EXAMPLE_LENGTH,
  MAX_RELATED_PICKS,
  generateDefinitionFromExample,
  generateDefinitions,
  generateElementFromSelection,
  generateEquivalent,
  generateExamples,
  generateForms,
  generateRelatedWords,
  sentenceUsesForm,
  verbalizeDefinition,
  type RelatedWord,
} from 'ai';
import { Reveal } from './reveal';
import { FrequencyGem } from './frequency-gem';
import { ModeIcon, modeColor } from './mode-icon';
import { ModeProgress } from './mode-progress';
import { readStepGoal } from './step-goal';
import { translatePhrase } from '../translate/translate';
import { canSpeak, speakText, stopSpeaking } from './speech';

const FORM_MAX_LENGTH = 100;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;

type Editor =
  | { kind: 'definition'; index: number | null }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number | null };

type FormEdit = { definitionIndex: number; originalText: string | null };

type MetadataEdit = { previousKey: string | null };

type PassageSelection = {
  text: string;
  definitionIndex: number;
  exampleIndex: number | null;
};

type PreparedElement = {
  title: string;
  definitions: ElementDefinition[];
  example: string;
};

type HighlightSource = {
  id: string;
  title: string;
  forms: string[];
  color: string;
  style: HighlightStyle;
};

function writeMetadata(
  metadata: ElementMetadata,
  previousKey: string | null,
  key: string,
  value: string,
): ElementMetadata {
  const next: ElementMetadata = {};
  let placed = false;
  for (const [currentKey, currentValue] of Object.entries(metadata)) {
    const samePrevious = previousKey != null && currentKey === previousKey;
    const sameKey = currentKey.toLowerCase() === key.toLowerCase();
    if (samePrevious || sameKey) {
      if (!placed) {
        next[key] = value;
        placed = true;
      }
      continue;
    }
    next[currentKey] = currentValue;
  }
  if (!placed) next[key] = value;
  return next;
}

type ConfirmDelete =
  | { kind: 'element' }
  | { kind: 'definition'; index: number }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number };

type DefinitionSuggestion = {
  text: string;
  metadata: ElementMetadata;
  frequency: DefinitionFrequency;
  example?: string;
};

const SUGGESTIONS_KEY = 'lingogem.definition-suggestions.v1';

function suggestionMetadata(raw: unknown): ElementMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const metadata: ElementMetadata = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = key.trim();
    if (!name || typeof value !== 'string') continue;
    const text = value.trim();
    if (text) metadata[name] = text;
  }
  return metadata;
}

function suggestionList(raw: unknown): DefinitionSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: DefinitionSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const example = String((item as { example?: unknown }).example ?? '')
      .trim()
      .slice(0, MAX_EXAMPLE_LENGTH);
    suggestions.push({
      text,
      metadata: suggestionMetadata((item as { metadata?: unknown }).metadata),
      frequency: normalizeDefinitionFrequency((item as { frequency?: unknown }).frequency),
      ...(example ? { example } : {}),
    });
  }
  return suggestions;
}

function readSuggestionStore(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SUGGESTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readDefinitionSuggestions(elementId: string): DefinitionSuggestion[] {
  if (!elementId) return [];
  return suggestionList(readSuggestionStore()[elementId]);
}

function watchDefinitionSuggestions(listener: (elementId: string) => void): () => void {
  suggestionListeners.add(listener);
  return () => suggestionListeners.delete(listener);
}

const suggestionListeners = new Set<(elementId: string) => void>();

function writeDefinitionSuggestions(
  elementId: string,
  suggestions: readonly DefinitionSuggestion[],
): void {
  if (typeof localStorage === 'undefined' || !elementId) return;
  const stored = readSuggestionStore();
  if (suggestions.length) stored[elementId] = suggestions;
  else delete stored[elementId];
  if (Object.keys(stored).length) {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(stored));
  } else localStorage.removeItem(SUGGESTIONS_KEY);
  for (const listener of suggestionListeners) listener(elementId);
}

type ExampleSuggestion = { text: string; form: string };

type EngineerDraft = { instruction: string; forms: string[] };

type ExampleEngineer = EngineerDraft & {
  definitionIndex: number;
  formsOpen: boolean;
};

type DefinitionEngineerDraft = {
  instruction: string;
  words: RelatedWord[];
  selected: string[];
};

type DefinitionEngineer = DefinitionEngineerDraft & {
  definitionIndex: number;
};

type WordingSuggestion = { text: string };

const RELATED_CACHE_KEY = 'lingogem.definition-related.v1';
const RELATED_RELATIONS = new Set(['synonym', 'antonym', 'hypernym', 'hyponym', 'related']);

function relatedDraft(value: unknown): DefinitionEngineerDraft | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { instruction?: unknown; words?: unknown; selected?: unknown };
  const instruction = String(source.instruction ?? '')
    .trim()
    .slice(0, MAX_DEFINITION_INSTRUCTION);
  const words: RelatedWord[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.words)) {
    for (const item of source.words) {
      if (!item || typeof item !== 'object') continue;
      const text = String((item as { text?: unknown }).text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const relation = String((item as { relation?: unknown }).relation ?? '')
        .trim()
        .toLowerCase();
      const key = text.toLowerCase();
      if (!text || !RELATED_RELATIONS.has(relation) || seen.has(key)) continue;
      seen.add(key);
      words.push({ text, relation: relation as RelatedWord['relation'] });
    }
  }
  const known = new Set(words.map((word) => word.text.toLowerCase()));
  const selected: string[] = [];
  if (Array.isArray(source.selected)) {
    for (const item of source.selected) {
      const text = String(item ?? '').trim();
      if (!text || !known.has(text.toLowerCase()) || selected.length >= MAX_RELATED_PICKS) continue;
      selected.push(text);
    }
  }
  if (!instruction && !words.length) return null;
  return { instruction, words, selected };
}

function readRelatedCache(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(RELATED_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readRelatedDrafts(elementId: string): Map<string, DefinitionEngineerDraft> {
  const drafts = new Map<string, DefinitionEngineerDraft>();
  if (!elementId) return drafts;
  const raw = readRelatedCache()[elementId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return drafts;
  for (const [key, value] of Object.entries(raw)) {
    const sense = key.trim().toLowerCase();
    const draft = relatedDraft(value);
    if (sense && draft) drafts.set(sense, draft);
  }
  return drafts;
}

function writeRelatedDrafts(
  elementId: string,
  drafts: ReadonlyMap<string, DefinitionEngineerDraft>,
): void {
  if (typeof localStorage === 'undefined' || !elementId) return;
  const stored = readRelatedCache();
  const bucket: Record<string, DefinitionEngineerDraft> = {};
  for (const [key, draft] of drafts) {
    const sense = key.trim().toLowerCase();
    if (!sense || (!draft.instruction && !draft.words.length)) continue;
    bucket[sense] = {
      instruction: draft.instruction,
      words: draft.words.map((word) => ({ text: word.text, relation: word.relation })),
      selected: [...draft.selected],
    };
  }
  if (Object.keys(bucket).length) stored[elementId] = bucket;
  else delete stored[elementId];
  if (Object.keys(stored).length) localStorage.setItem(RELATED_CACHE_KEY, JSON.stringify(stored));
  else localStorage.removeItem(RELATED_CACHE_KEY);
}

const EXAMPLE_SUGGESTIONS_KEY = 'lingogem.example-suggestions.v1';

function senseKey(text: string): string {
  return parsePassage(text).text.trim().toLowerCase();
}

function joinPhrase(current: string, addition: string): string {
  const left = current.replace(/\s+/g, ' ').trim();
  const right = addition.replace(/\s+/g, ' ').trim();
  if (!right) return left;
  if (!left) return right;
  return `${left} ${right}`;
}

function definitionFromDraft(current: string, gloss: string, english: string): string {
  const parsed = parsePassage(current);
  const languages = new Set(parsed.translations.map((item) => item.language));
  const nextEnglish = english.replace(/\s+/g, ' ').trim();
  if (nextEnglish) languages.add('en');
  else languages.delete('en');
  let text = gloss.replace(/\s+/g, ' ').trim();
  for (const language of [...languages].sort()) {
    const value =
      language === 'en'
        ? nextEnglish
        : (parsed.translations.find((item) => item.language === language)?.text ?? '');
    if (value) text = embedTranslation(text, language, value);
  }
  return text;
}

function appendDefinitionPhrase(current: string, addition: string): string {
  const base = parsePassage(current);
  const extra = parsePassage(addition);
  const gloss = [base.text, extra.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const languages = new Set<string>();
  for (const item of [...base.translations, ...extra.translations]) {
    if (item.language) languages.add(item.language);
  }
  let text = gloss;
  for (const language of [...languages].sort()) {
    const joined = [base, extra]
      .map((passage) => passage.translations.find((item) => item.language === language)?.text ?? '')
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined) text = embedTranslation(text, language, joined);
  }
  return text;
}

function exampleSuggestionList(raw: unknown): ExampleSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: ExampleSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const form = String((item as { form?: unknown }).form ?? '').trim();
    suggestions.push({ text, form });
  }
  return suggestions;
}

function readExampleSuggestionStore(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EXAMPLE_SUGGESTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readExampleSuggestions(elementId: string): Record<string, ExampleSuggestion[]> {
  if (!elementId) return {};
  const raw = readExampleSuggestionStore()[elementId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const lists: Record<string, ExampleSuggestion[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const sense = key.trim().toLowerCase();
    const list = exampleSuggestionList(value);
    if (sense && list.length) lists[sense] = list;
  }
  return lists;
}

function watchExampleSuggestions(listener: (elementId: string) => void): () => void {
  exampleSuggestionListeners.add(listener);
  return () => exampleSuggestionListeners.delete(listener);
}

const exampleSuggestionListeners = new Set<(elementId: string) => void>();

const WORDING_SUGGESTIONS_KEY = 'lingogem.definition-wording.v1';

function wordingSuggestionList(raw: unknown): WordingSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: WordingSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    suggestions.push({ text });
  }
  return suggestions;
}

function readWordingSuggestionStore(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(WORDING_SUGGESTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readWordingSuggestions(elementId: string): Record<string, WordingSuggestion[]> {
  if (!elementId) return {};
  const raw = readWordingSuggestionStore()[elementId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const lists: Record<string, WordingSuggestion[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const sense = key.trim().toLowerCase();
    const list = wordingSuggestionList(value);
    if (sense && list.length) lists[sense] = list;
  }
  return lists;
}

function watchWordingSuggestions(listener: (elementId: string) => void): () => void {
  wordingSuggestionListeners.add(listener);
  return () => wordingSuggestionListeners.delete(listener);
}

const wordingSuggestionListeners = new Set<(elementId: string) => void>();

function writeWordingSuggestions(
  elementId: string,
  lists: Record<string, WordingSuggestion[]>,
): void {
  if (typeof localStorage === 'undefined' || !elementId) return;
  const stored = readWordingSuggestionStore();
  const bucket: Record<string, WordingSuggestion[]> = {};
  for (const [key, list] of Object.entries(lists)) {
    const sense = key.trim().toLowerCase();
    if (sense && list.length) bucket[sense] = list;
  }
  if (Object.keys(bucket).length) stored[elementId] = bucket;
  else delete stored[elementId];
  if (Object.keys(stored).length) {
    localStorage.setItem(WORDING_SUGGESTIONS_KEY, JSON.stringify(stored));
  } else localStorage.removeItem(WORDING_SUGGESTIONS_KEY);
  for (const listener of wordingSuggestionListeners) listener(elementId);
}

function writeExampleSuggestions(
  elementId: string,
  lists: Record<string, ExampleSuggestion[]>,
): void {
  if (typeof localStorage === 'undefined' || !elementId) return;
  const stored = readExampleSuggestionStore();
  const bucket: Record<string, ExampleSuggestion[]> = {};
  for (const [key, list] of Object.entries(lists)) {
    const sense = key.trim().toLowerCase();
    if (sense && list.length) bucket[sense] = list;
  }
  if (Object.keys(bucket).length) stored[elementId] = bucket;
  else delete stored[elementId];
  if (Object.keys(stored).length) {
    localStorage.setItem(EXAMPLE_SUGGESTIONS_KEY, JSON.stringify(stored));
  } else localStorage.removeItem(EXAMPLE_SUGGESTIONS_KEY);
  for (const listener of exampleSuggestionListeners) listener(elementId);
}

@Component({
  selector: 'app-element-modal',
  imports: [Reveal, ModeIcon, ModeProgress, FrequencyGem],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="shownTitle()"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-row">
            @if (canGoBack()) {
              <button
                type="button"
                class="icon-btn"
                aria-label="Back"
                title="Back"
                [disabled]="busy()"
                (click)="back.emit()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            }
            @if (titleEdit()) {
              <form class="title-edit" (submit)="saveTitle($event)">
                <input
                  #titleField
                  aria-label="Title"
                  [value]="titleDraft()"
                  [attr.maxlength]="formMaxLength"
                  autocomplete="off"
                  [disabled]="busy()"
                  (input)="titleDraft.set(inputValue($event))"
                />
                <button
                  type="submit"
                  class="icon-btn"
                  aria-label="Save title"
                  title="Save title"
                  [disabled]="busy() || !titleDraft().trim()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              </form>
            } @else {
              <div class="title-main">
                <h2>{{ shownTitle() }}</h2>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Edit title"
                  title="Edit title"
                  [disabled]="aiBusy()"
                  (click)="openTitle()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
              </div>
            }
            <button
              #closeButton
              type="button"
              class="close"
              aria-label="Close"
              (click)="closed.emit()"
            >
              ×
            </button>
          </div>
          @if (titleError()) {
            <p class="error">{{ titleError() }}</p>
          }
          @if (headerEquivalents(); as equivalents) {
            @if (equivalents.length) {
              <p class="equivalents">
                @for (text of equivalents; track $index) {
                  @if ($index > 0) {
                    <span class="sep" aria-hidden="true">·</span>
                  }
                  <app-reveal [text]="text" [language]="element().language" />
                }
              </p>
            }
          }
          <div class="header-actions">
            <button
              type="button"
              class="icon-btn highlight-btn"
              aria-label="Highlight color"
              title="Highlight color"
              [attr.aria-expanded]="colorOpen()"
              [disabled]="aiBusy()"
              [style.--swatch]="highlightColor(element())"
              (click)="openHighlight()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 11-6 6v3h9l3-3" />
                <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
              </svg>
            </button>
            <div class="mode-control">
              <button
                type="button"
                class="mode-btn"
                [attr.aria-label]="modeLabel(element().mode)"
                [attr.title]="modeLabel(element().mode)"
                [attr.aria-expanded]="modeOpen()"
                [disabled]="busy()"
                (click)="modeOpen.set(true)"
              >
                <app-mode-icon [mode]="element().mode" />
              </button>
              <app-mode-progress
                [mode]="element().mode"
                [succeeded]="0"
                [goal]="readStepGoal(element().language)"
                [compact]="true"
              />
            </div>
            @if (canHear(shownTitle())) {
              <button
                type="button"
                class="icon-btn"
                [class.active]="speaking() === 'title'"
                [attr.aria-pressed]="speaking() === 'title'"
                [attr.aria-label]="speaking() === 'title' ? 'Stop speaking' : 'Hear title'"
                [attr.title]="speaking() === 'title' ? 'Stop speaking' : 'Hear title'"
                (click)="hear('title', shownTitle())"
              >
                @if (speaking() === 'title') {
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect class="solid" width="10" height="10" x="7" y="7" rx="1" />
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                }
              </button>
            }
            <button
              type="button"
              class="icon-btn"
              aria-label="Translations"
              title="Translations"
              [disabled]="busy()"
              (click)="openTranslations()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </button>
          </div>
        </header>
        <div class="body">
          <div class="section-heading">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
                />
                <path d="m8 13 4-7 4 7" />
                <path d="M9.1 11h5.7" />
              </svg>
              Definitions
            </h3>
            <div class="header-actions">
              <button
                type="button"
                class="icon-btn"
                aria-label="Add a definition"
                title="Add a definition"
                [disabled]="aiBusy()"
                (click)="openAddDefinition()"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
              </button>
            </div>
          </div>
          @if (collision(); as matches) {
            <div class="collision" role="menu" aria-label="Matching elements">
              @for (match of matches; track match.elementId) {
                <button type="button" (click)="visitHighlight(match.elementId)">
                  {{ shownTitle(match.title) }}
                </button>
              }
            </div>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          @if (suggestions().length) {
            <ol class="definitions">
              @for (suggestion of suggestions(); track suggestion.text; let index = $index) {
                <li class="sense suggestion">
                  <div class="sense-main">
                    <div class="sense-copy">
                      @let passage = parsePassage(suggestion.text);
                      @if (passage.text) {
                        <p class="passage">{{ passage.text }}</p>
                      }
                      @if (passage.translations.length) {
                        <ul class="equivalents">
                          @for (translation of passage.translations; track $index) {
                            <li>
                              <app-reveal [text]="translation.text" [language]="element().language" />
                            </li>
                          }
                        </ul>
                      }
                      <ul class="sense-meta">
                        <li class="sense-frequency">
                          <app-frequency-gem [frequency]="suggestion.frequency" />
                          {{ frequencyLabel(suggestion.frequency) }}
                        </li>
                        @for (entry of entries(suggestion.metadata); track entry.key) {
                          <li>
                            <span class="sense-meta-key">{{ label(entry.key) }}</span>
                            {{ label(entry.value) }}
                          </li>
                        }
                      </ul>
                      @if (suggestion.example) {
                        <div class="example-quote">
                          <p class="passage example-line">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                              />
                              <path
                                d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                              />
                            </svg>
                            <span>{{ suggestion.example }}</span>
                          </p>
                        </div>
                      }
                    </div>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Dismiss definition"
                      title="Dismiss definition"
                      [disabled]="busy()"
                      (click)="dismissSuggestion(index)"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    class="btn btn-primary add-suggestion"
                    [disabled]="aiBusy()"
                    (click)="addSuggestion(index)"
                  >
                    Add
                  </button>
                </li>
              }
            </ol>
          }
          @if (element().definitions.length) {
            <ol class="definitions">
              @for (definition of element().definitions; track $index; let index = $index) {
                <li class="sense">
                  <div class="sense-main">
                    <div class="sense-copy">
                      @let passage = parsePassage(definition.text);
                      @if (passage.text) {
                        <p
                          class="passage sense-selectable"
                          [attr.data-definition-index]="index"
                        >
                          @for (part of highlightPassage(passage.text); track $index) {
                            @if (part.matches.length > 1) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [style.--highlight-color]="part.color"
                                [style.--highlight-style]="part.style"
                                [textContent]="part.text"
                                (click)="showCollision($event, part.matches)"
                              ></button>
                            } @else if (part.matches.length === 1 && !part.current) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [style.--highlight-color]="part.color"
                                [style.--highlight-style]="part.style"
                                [textContent]="part.text"
                                (click)="visitHighlight(part.matches[0].elementId)"
                              ></button>
                            } @else if (part.current) {
                              <span
                                class="linguagem-highlighted linguagem-highlighted--current"
                                [style.--highlight-color]="part.color"
                                [style.--highlight-style]="part.style"
                                [textContent]="part.text"
                              ></span>
                            } @else {
                              <span [textContent]="part.text"></span>
                            }
                          }
                        </p>
                      }
                      @if (passage.translations.length) {
                        <ul class="equivalents">
                          @for (translation of passage.translations; track $index) {
                            <li>
                              <app-reveal [text]="translation.text" [language]="element().language" />
                            </li>
                          }
                        </ul>
                      }
                      @let equivalent = equivalentText(definition);
                      @let meta = entries(definition.metadata);
                      <ul class="sense-meta">
                        @if (equivalent) {
                          <li class="sense-equivalent">
                            <app-reveal [text]="equivalent" [language]="element().language" />
                          </li>
                        }
                        <li class="sense-frequency">
                          <app-frequency-gem [frequency]="definition.frequency" />
                          {{ frequencyLabel(definition.frequency) }}
                        </li>
                        @for (entry of meta; track entry.key) {
                          <li>
                            <span class="sense-meta-key">{{ label(entry.key) }}</span>
                            {{ label(entry.value) }}
                          </li>
                        }
                      </ul>
                    </div>
                  </div>
                  <div class="item-actions">
                    @if (passagePick(index, null); as pick) {
                      <span class="lookup-actions">
                        <button
                          type="button"
                          class="lookup-chip"
                          aria-label="Add element"
                          [disabled]="aiBusy()"
                          (pointerdown)="confirmPassagePick($event, pick.text)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                          Add
                        </button>
                        <button
                          type="button"
                          class="lookup-chip"
                          aria-label="Add element with AI"
                          [disabled]="aiBusy()"
                          [attr.aria-busy]="addingSelection() ? true : null"
                          (pointerdown)="confirmPassagePick($event, pick.text, true)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                            />
                          </svg>
                          Ask AI
                        </button>
                      </span>
                    } @else {
                    @if (element().definitions.length > 1) {
                      <span class="item-actions-move">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Move definition up"
                          title="Move definition up"
                          [disabled]="aiBusy() || index === 0"
                          (click)="moveDefinition(index, -1)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m18 15-6-6-6 6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Move definition down"
                          title="Move definition down"
                          [disabled]="aiBusy() || index === element().definitions.length - 1"
                          (click)="moveDefinition(index, 1)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </span>
                    }
                    <span class="item-actions-main">
                      @if (canHear(definition.text)) {
                        <button
                          type="button"
                          class="icon-btn"
                          [class.active]="speaking() === 'definition:' + index"
                          [attr.aria-pressed]="speaking() === 'definition:' + index"
                          [attr.aria-label]="
                            speaking() === 'definition:' + index
                              ? 'Stop speaking'
                              : 'Hear definition'
                          "
                          [attr.title]="
                            speaking() === 'definition:' + index
                              ? 'Stop speaking'
                              : 'Hear definition'
                          "
                          (click)="hear('definition:' + index, definition.text)"
                        >
                          @if (speaking() === 'definition:' + index) {
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <rect class="solid" width="10" height="10" x="7" y="7" rx="1" />
                            </svg>
                          } @else {
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                          }
                        </button>
                      }
                      <button
                        type="button"
                        class="icon-btn"
                        [class.copied]="copied() === 'definition:' + index"
                        [attr.aria-label]="
                          copied() === 'definition:' + index ? 'Copied' : 'Copy definition'
                        "
                        [attr.title]="
                          copied() === 'definition:' + index ? 'Copied' : 'Copy definition'
                        "
                        (click)="copyText('definition:' + index, definition.text)"
                      >
                        @if (copied() === 'definition:' + index) {
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        } @else {
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                        }
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        [attr.aria-label]="
                          definition.equivalentId ? 'Edit definition' : 'Add an equivalent'
                        "
                        [attr.title]="
                          definition.equivalentId ? 'Edit definition' : 'Add an equivalent'
                        "
                        [disabled]="aiBusy()"
                        (click)="openDefinition(index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                        @if (!definition.equivalentId) {
                          <span class="notify" aria-hidden="true"></span>
                        }
                      </button>
                      <button
                        type="button"
                        class="icon-btn danger"
                        aria-label="Delete definition"
                        title="Delete definition"
                        [disabled]="aiBusy()"
                        (click)="askDeleteDefinition(index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </span>
                    }
                  </div>

                  <section class="group">
                    <div class="section-heading">
                      <h3 class="section-title">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                          />
                          <path
                            d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                          />
                        </svg>
                        Examples
                      </h3>
                      <div class="header-actions">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Add an example"
                          title="Add an example"
                          [disabled]="aiBusy()"
                          (click)="openAddExample(index)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (definition.examples.length) {
                      <ul class="examples">
                        @for (
                          exampleIndex of exampleIndexesNewestFirst(definition.examples.length);
                          track exampleIndex
                        ) {
                          @let example = definition.examples[exampleIndex];
                          <li class="saved-example">
                            <div class="example-quote">
                              @let passage = parsePassage(example.text);
                              @if (passage.text) {
                                <p
                                  class="passage sense-selectable"
                                  [attr.data-definition-index]="index"
                                  [attr.data-example-index]="exampleIndex"
                                >
                                  @for (
                                    part of highlightPassage(passage.text);
                                    track $index
                                  ) {
                                    @if (part.matches.length > 1) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [style.--highlight-color]="part.color"
                                        [style.--highlight-style]="part.style"
                                        [textContent]="part.text"
                                        (click)="showCollision($event, part.matches)"
                                      ></button>
                                    } @else if (part.matches.length === 1 && !part.current) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [style.--highlight-color]="part.color"
                                        [style.--highlight-style]="part.style"
                                        [textContent]="part.text"
                                        (click)="visitHighlight(part.matches[0].elementId)"
                                      ></button>
                                    } @else if (part.current) {
                                      <span
                                        class="linguagem-highlighted linguagem-highlighted--current"
                                        [style.--highlight-color]="part.color"
                                        [style.--highlight-style]="part.style"
                                        [textContent]="part.text"
                                      ></span>
                                    } @else {
                                      <span [textContent]="part.text"></span>
                                    }
                                  }
                                </p>
                              }
                              @if (passage.translations.length) {
                                <ul class="equivalents">
                                  @for (translation of passage.translations; track $index) {
                                    <li><app-reveal [text]="translation.text" [language]="element().language" /></li>
                                  }
                                </ul>
                              }
                              @if (entries(example.metadata); as meta) {
                                @if (meta.length) {
                                  <ul class="pills">
                                    @for (entry of meta; track entry.key) {
                                      <li>
                                        <span>{{ entry.key }}: {{ entry.value }}</span>
                                      </li>
                                    }
                                  </ul>
                                }
                              }
                            </div>
                            <div class="item-actions">
                              @if (passagePick(index, exampleIndex); as pick) {
                                <span class="lookup-actions">
                                  <button
                                    type="button"
                                    class="lookup-chip"
                                    aria-label="Add element"
                                    [disabled]="aiBusy()"
                                    (pointerdown)="confirmPassagePick($event, pick.text)"
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M5 12h14" />
                                      <path d="M12 5v14" />
                                    </svg>
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    class="lookup-chip"
                                    aria-label="Add element with AI"
                                    [disabled]="aiBusy()"
                                    [attr.aria-busy]="addingSelection() ? true : null"
                                    (pointerdown)="confirmPassagePick($event, pick.text, true)"
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path
                                        d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                                      />
                                    </svg>
                                    Ask AI
                                  </button>
                                </span>
                              } @else {
                              <span class="item-actions-main">
                                @if (canHear(example.text)) {
                                  <button
                                    type="button"
                                    class="icon-btn"
                                    [class.active]="
                                      speaking() === 'example:' + index + ':' + exampleIndex
                                    "
                                    [attr.aria-pressed]="
                                      speaking() === 'example:' + index + ':' + exampleIndex
                                    "
                                    [attr.aria-label]="
                                      speaking() === 'example:' + index + ':' + exampleIndex
                                        ? 'Stop speaking'
                                        : 'Hear example'
                                    "
                                    [attr.title]="
                                      speaking() === 'example:' + index + ':' + exampleIndex
                                        ? 'Stop speaking'
                                        : 'Hear example'
                                    "
                                    (click)="
                                      hear('example:' + index + ':' + exampleIndex, example.text)
                                    "
                                  >
                                    @if (speaking() === 'example:' + index + ':' + exampleIndex) {
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <rect
                                          class="solid"
                                          width="10"
                                          height="10"
                                          x="7"
                                          y="7"
                                          rx="1"
                                        />
                                      </svg>
                                    } @else {
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                                      </svg>
                                    }
                                  </button>
                                }
                                <button
                                  type="button"
                                  class="icon-btn"
                                  [class.copied]="
                                    copied() === 'example:' + index + ':' + exampleIndex
                                  "
                                  [attr.aria-label]="
                                    copied() === 'example:' + index + ':' + exampleIndex
                                      ? 'Copied'
                                      : 'Copy example'
                                  "
                                  [attr.title]="
                                    copied() === 'example:' + index + ':' + exampleIndex
                                      ? 'Copied'
                                      : 'Copy example'
                                  "
                                  (click)="
                                    copyText('example:' + index + ':' + exampleIndex, example.text)
                                  "
                                >
                                  @if (copied() === 'example:' + index + ':' + exampleIndex) {
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                  } @else {
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                      <path
                                        d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
                                      />
                                    </svg>
                                  }
                                </button>
                                <button
                                  type="button"
                                  class="icon-btn"
                                  aria-label="Edit example"
                                  title="Edit example"
                                  [disabled]="aiBusy()"
                                  (click)="openExample(index, exampleIndex)"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  class="icon-btn danger"
                                  aria-label="Delete example"
                                  title="Delete example"
                                  [disabled]="aiBusy()"
                                  (click)="askDeleteExample(index, exampleIndex)"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                    <path d="M10 11v6" />
                                    <path d="M14 11v6" />
                                  </svg>
                                </button>
                              </span>
                              }
                            </div>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="hint">No examples yet.</p>
                    }
                  </section>

                  <section class="group">
                    <div class="section-heading">
                      <h3 class="section-title">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
                          />
                          <path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5" />
                          <path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5" />
                        </svg>
                        Forms
                      </h3>
                      <div class="header-actions">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Add a form"
                          title="Add a form"
                          [disabled]="aiBusy()"
                          (click)="openAddForm(index)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (definition.forms.length) {
                      <ul class="forms">
                        @for (form of definition.forms; track form.text) {
                          <li>
                            <div class="form-chip">
                              <button
                                type="button"
                                [disabled]="busy()"
                                [attr.aria-label]="'Edit form ' + form.text"
                                (click)="openExistingForm(index, form.text)"
                              >
                                {{ form.text }}
                              </button>
                              <button
                                type="button"
                                class="tag-remove"
                                [disabled]="busy()"
                                [attr.aria-label]="'Remove form ' + form.text"
                                (click)="removeForm(index, form.text)"
                              >
                                ×
                              </button>
                            </div>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="hint">No forms yet.</p>
                    }
                  </section>
                </li>
              }
            </ol>
          } @else if (!suggestions().length) {
            <p class="empty">No definitions yet.</p>
          }
          <button
            type="button"
            class="btn btn-danger delete-element"
            [disabled]="busy()"
            (click)="askDeleteElement()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete
          </button>
        </div>

        @if (translationsOpen()) {
          <div class="sheet-backdrop" (click)="closeTranslations($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Translations"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Translations</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="dismissTranslations()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <label for="title-translation">Translation</label>
              <div class="form-edit">
                <input
                  #translationField
                  id="title-translation"
                  [value]="titleTranslationDraft()"
                  placeholder="English"
                  autocomplete="off"
                  [disabled]="busy()"
                  (input)="titleTranslationDraft.set(inputValue($event))"
                  (keydown.enter)="saveTitleTranslation()"
                />
                <button
                  type="button"
                  class="icon-btn"
                  [disabled]="busy() || !titleTranslationDraft().trim()"
                  [attr.aria-label]="translationEditId() ? 'Save translation' : 'Add translation'"
                  [attr.title]="translationEditId() ? 'Save translation' : 'Add translation'"
                  (click)="saveTitleTranslation()"
                >
                  @if (translationEditId()) {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="M12 5v14" />
                    </svg>
                  }
                </button>
              </div>
              @if (element().equivalents.length) {
                <ul class="pills">
                  @for (item of element().equivalents; track item.id) {
                    <li>
                      <button
                        type="button"
                        [disabled]="busy()"
                        [attr.aria-label]="'Edit translation ' + ($index + 1)"
                        (click)="editTitleTranslation(item.id)"
                      >
                        <app-reveal [text]="item.text" [language]="element().language" />
                      </button>
                      <button
                        type="button"
                        class="tag-remove"
                        [disabled]="busy()"
                        [attr.aria-label]="'Remove translation ' + ($index + 1)"
                        (click)="removeTitleTranslation(item.id)"
                      >
                        ×
                      </button>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }

        @if (editor(); as current) {
          <div class="sheet-backdrop" (click)="closeSheet($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="sheetTitle(current)"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>{{ sheetTitle(current) }}</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="editor.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="field-heading">
                <label
                  [attr.for]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                >
                  {{ current.kind === 'definition' ? 'Definition' : 'Example' }}
                </label>
                @if (current.kind === 'definition' && current.index != null) {
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Engineer definition"
                    title="Engineer definition"
                    [attr.aria-busy]="definitionEngineerBusy(current.index) ? true : null"
                    [disabled]="aiBusy()"
                    (click)="openDefinitionEngineer(current.index)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                      />
                      <path d="M5 3v4" />
                      <path d="M3 5h4" />
                      <path d="M19 17v4" />
                      <path d="M17 19h4" />
                    </svg>
                  </button>
                }
              </div>
              <textarea
                #draftField
                [id]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                rows="3"
                [value]="textDraft()"
                (input)="textDraft.set(inputValue($event))"
              ></textarea>
              @if (showTranslationField()) {
                <div class="field-heading">
                  <label for="translation-text">Translation</label>
                  <button
                    type="button"
                    class="icon-btn"
                    [attr.aria-label]="translating() ? 'Translating…' : 'Translate'"
                    [attr.title]="translating() ? 'Translating…' : 'Translate'"
                    [disabled]="!canTranslate()"
                    (click)="translateDraft()"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="m5 8 6 6" />
                      <path d="m4 14 6-6 2-3" />
                      <path d="M2 5h12" />
                      <path d="M7 2h1" />
                      <path d="m22 22-5-10-5 10" />
                      <path d="M14 18h6" />
                    </svg>
                  </button>
                </div>
                <textarea
                  id="translation-text"
                  rows="2"
                  [value]="translationDraft()"
                  (input)="setTranslationDraft(inputValue($event))"
                  placeholder="English"
                ></textarea>
              }
              @if (sheetError()) {
                <p class="error">{{ sheetError() }}</p>
              }
              @if (current.kind === 'definition') {
                <div class="equivalent-block" [class.missing]="equivalentMissing()">
                  <div class="field-heading">
                    @if (element().equivalents.length) {
                      <p class="field-label">Equivalent</p>
                    } @else {
                      <label for="definition-equivalent">Equivalent</label>
                    }
                    @if (element().language !== 'en') {
                      <button
                        type="button"
                        class="icon-btn"
                        [attr.aria-label]="
                          askingEquivalent() ? 'Finding an equivalent…' : 'Ask AI for an equivalent'
                        "
                        [attr.title]="
                          askingEquivalent() ? 'Finding an equivalent…' : 'Ask AI for an equivalent'
                        "
                        [attr.aria-busy]="askingEquivalent() ? true : null"
                        [disabled]="!canAskEquivalent()"
                        (click)="askEquivalent()"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                          />
                          <path d="M5 3v4" />
                          <path d="M3 5h4" />
                          <path d="M19 17v4" />
                          <path d="M17 19h4" />
                        </svg>
                      </button>
                    }
                  </div>
                  @if (element().equivalents.length) {
                    <ul class="equivalent-choices">
                      @for (item of element().equivalents; track item.id) {
                        <li>
                          <button
                            type="button"
                            [class.selected]="equivalentSelected(item.id)"
                            [attr.aria-pressed]="equivalentSelected(item.id)"
                            [disabled]="busy()"
                            aria-label="Show translation"
                            (click)="chooseEquivalent(item.id)"
                          >
                            <app-reveal [text]="item.text" [language]="element().language" />
                          </button>
                        </li>
                      }
                    </ul>
                    <label for="definition-equivalent">New equivalent</label>
                  }
                  <input
                    id="definition-equivalent"
                    [value]="equivalentDraft()"
                    (input)="equivalentDraft.set(inputValue($event))"
                    autocomplete="off"
                    placeholder="Type a new equivalent"
                  />
                </div>
              }
              @if (current.kind === 'definition') {
                <div class="frequency-field">
                  <p class="field-label">Frequency</p>
                  <div class="frequency-choices" role="radiogroup" aria-label="Frequency">
                    @for (frequency of frequencies; track frequency) {
                      <button
                        type="button"
                        class="frequency-choice"
                        [class.selected]="frequencyDraft() === frequency"
                        [attr.aria-pressed]="frequencyDraft() === frequency"
                        [attr.aria-label]="frequencyLabel(frequency)"
                        [disabled]="busy()"
                        (click)="frequencyDraft.set(frequency)"
                      >
                        <app-frequency-gem [frequency]="frequency" />
                        <span>{{ frequencyLabel(frequency) }}</span>
                      </button>
                    }
                  </div>
                </div>
              }
              <div class="meta">
                <div class="section-heading">
                  <h3>Metadata</h3>
                  @if (!metaEdit()) {
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Add metadata"
                      title="Add metadata"
                      [disabled]="busy()"
                      (click)="openMetadata(null)"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                    </button>
                  }
                </div>
                @if (metaEdit(); as editing) {
                  <div class="meta-edit">
                    <input
                      #metaKeyField
                      [value]="metaKey()"
                      [attr.maxlength]="metaKeyMaxLength"
                      placeholder="Key"
                      aria-label="Metadata key"
                      (input)="metaKey.set(inputValue($event))"
                      (keydown.enter)="saveMetadata()"
                    />
                    <input
                      [value]="metaValue()"
                      [attr.maxlength]="metaValueMaxLength"
                      placeholder="Value"
                      aria-label="Metadata value"
                      (input)="metaValue.set(inputValue($event))"
                      (keydown.enter)="saveMetadata()"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      [disabled]="busy() || !metaKey().trim() || !metaValue().trim()"
                      [attr.aria-label]="editing.previousKey ? 'Save metadata' : 'Add metadata'"
                      (click)="saveMetadata()"
                    >
                      <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Cancel"
                      (click)="cancelMetadata()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                }
                @if (entries(sheetMetadata()); as meta) {
                  @if (meta.length) {
                    <ul class="pills">
                      @for (entry of meta; track entry.key) {
                        @if (metaEdit()?.previousKey !== entry.key) {
                          <li>
                            <button
                              type="button"
                              [disabled]="busy()"
                              [attr.aria-label]="'Edit metadata ' + entry.key"
                              (click)="openMetadata(entry.key)"
                            >
                              {{ entry.key }}: {{ entry.value }}
                            </button>
                            <button
                              type="button"
                              class="tag-remove"
                              [disabled]="busy()"
                              [attr.aria-label]="'Remove metadata ' + entry.key"
                              (click)="removeMetadata(entry.key)"
                            >
                              ×
                            </button>
                          </li>
                        }
                      }
                    </ul>
                  }
                }
              </div>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() || translating() || askingEquivalent() || !textDraft().trim()"
                  (click)="saveEditor()"
                >
                  Save
                </button>
                @if (current.kind === 'example' && current.exampleIndex != null) {
                  <button
                    type="button"
                    class="btn btn-danger"
                    [disabled]="busy()"
                    (click)="askDelete()"
                  >
                    Delete example
                  </button>
                }
              </div>
            </section>
          </div>
        }

        @if (exampleEngineer(); as engineer) {
          <div class="sheet-backdrop" (click)="closeExampleEngineer($event)">
            <section
              class="sheet engineer-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Ask AI for examples"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Ask AI for examples</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="askingExamples() !== null"
                  (click)="exampleEngineer.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <label class="field-label" for="example-note">Note</label>
              <textarea
                id="example-note"
                rows="3"
                [value]="engineer.instruction"
                [attr.maxlength]="exampleInstructionMax"
                [disabled]="askingExamples() !== null"
                placeholder="A walk to the market"
                aria-label="Note"
                (input)="onEngineerInstruction($event)"
              ></textarea>
              @if (definitionForms(engineer.definitionIndex); as forms) {
                @if (forms.length) {
                  <button
                    type="button"
                    class="forms-toggle"
                    [attr.aria-expanded]="engineer.formsOpen"
                    [disabled]="askingExamples() !== null"
                    (click)="toggleEngineerForms()"
                  >
                    <span>Forms</span>
                    <span class="forms-toggle-side">
                      @if (!engineer.formsOpen && engineer.forms.length) {
                        <span>{{ engineer.forms.join(', ') }}</span>
                      }
                      <svg viewBox="0 0 24 24" aria-hidden="true" [class.open]="engineer.formsOpen">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  @if (engineer.formsOpen) {
                    <div class="engineer-forms">
                      <p class="hint">
                        Select forms to require. More than one picks a form at random.
                      </p>
                      <ul class="equivalent-choices">
                        @for (form of forms; track form) {
                          <li>
                            <button
                              type="button"
                              [class.selected]="engineerFormChosen(form)"
                              [attr.aria-pressed]="engineerFormChosen(form)"
                              [disabled]="askingExamples() !== null"
                              (click)="toggleEngineerForm(form)"
                            >
                              {{ form }}
                            </button>
                          </li>
                        }
                      </ul>
                    </div>
                  }
                }
              }
              @if (error()) {
                <p class="error">{{ error() }}</p>
              }
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="askingExamples() !== null"
                  [attr.aria-busy]="askingExamples() !== null ? true : null"
                  (click)="generateEngineeredExample()"
                >
                  Generate
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="askingExamples() !== null"
                  (click)="exampleEngineer.set(null)"
                >
                  Cancel
                </button>
              </div>
            </section>
          </div>
        }

        @if (definitionEngineer(); as engineer) {
          <div class="sheet-backdrop definition-layer" (click)="closeDefinitionEngineer($event)">
            <section
              class="sheet definition-engineer"
              role="dialog"
              aria-modal="true"
              aria-label="Engineer definition"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <div class="sheet-title">
                  <h3>Engineer definition</h3>
                  <p class="hint">{{ shownTitle() }}</p>
                </div>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="definitionSheetBusy()"
                  (click)="definitionEngineer.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <label class="field-label" for="definition-note">Instructions</label>
              <textarea
                id="definition-note"
                class="instruction-note"
                rows="1"
                [value]="engineer.instruction"
                [attr.maxlength]="definitionInstructionMax"
                [disabled]="definitionSheetBusy()"
                placeholder="How this word sits among the others"
                aria-label="Instructions"
                (input)="onDefinitionEngineerInstruction($event)"
              ></textarea>
              <div class="related-block">
                <div class="section-heading">
                  <span class="field-label">Related</span>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="definitionSheetBusy()"
                    [attr.aria-busy]="askingRelated() !== null ? true : null"
                    (click)="findRelatedWords()"
                  >
                    Find related
                  </button>
                </div>
                @if (engineer.words.length) {
                  <p class="hint">Optional. Select up to four.</p>
                  <div class="engineer-words">
                    <ul class="equivalent-choices">
                      @for (word of engineer.words; track word.text) {
                        <li>
                          <button
                            type="button"
                            class="related-chip"
                            [class.selected]="relatedWordChosen(word)"
                            [attr.aria-pressed]="relatedWordChosen(word)"
                            [disabled]="definitionSheetBusy()"
                            (click)="toggleRelatedWord(word)"
                          >
                            <span class="related-word">{{ word.text }}</span>
                            <span class="relation">{{ label(word.relation) }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                  </div>
                } @else {
                  <p class="hint">Words tied to this definition show up here.</p>
                }
              </div>
              <div class="definition-draft">
                <label class="field-label" for="engineer-gloss">Definition</label>
                <textarea
                  id="engineer-gloss"
                  rows="2"
                  [value]="engineerGloss()"
                  [disabled]="definitionSheetBusy()"
                  aria-label="Definition"
                  (input)="onEngineerGloss($event)"
                ></textarea>
                @if (element().language !== 'en') {
                  <label class="field-label" for="engineer-english">English</label>
                  <textarea
                    id="engineer-english"
                    rows="2"
                    [value]="engineerEnglish()"
                    [disabled]="definitionSheetBusy()"
                    aria-label="English"
                    (input)="onEngineerEnglish($event)"
                  ></textarea>
                }
              </div>
              @if (error()) {
                <p class="error">{{ error() }}</p>
              }
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="
                    definitionSheetBusy() ||
                    (!engineer.instruction.trim() && !engineer.selected.length)
                  "
                  [attr.aria-busy]="askingWording() !== null ? true : null"
                  (click)="generateEngineeredDefinition()"
                >
                  Append
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="aiBusy() || !engineerGloss().trim()"
                  (click)="saveEngineeredDefinition()"
                >
                  Save
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="definitionSheetBusy()"
                  (click)="definitionEngineer.set(null)"
                >
                  Cancel
                </button>
              </div>
            </section>
          </div>
        }

        @if (formEdit(); as editing) {
          <div class="sheet-backdrop" (click)="closeFormSheet($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="editing.originalText ? 'Edit form' : 'Add a form'"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>{{ editing.originalText ? 'Edit form' : 'Add a form' }}</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="busy()"
                  (click)="cancelForm()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <label for="new-form">Form</label>
              <input
                #formField
                id="new-form"
                [value]="formDraft()"
                [attr.maxlength]="formMaxLength"
                placeholder="walked"
                autocomplete="off"
                (input)="onFormInput($event)"
                (keydown.enter)="saveForm()"
              />
              @if (formError()) {
                <p class="error">{{ formError() }}</p>
              }
              <div class="meta">
                <div class="section-heading">
                  <h3>Metadata</h3>
                  @if (!formFeatureEdit()) {
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Add metadata"
                      title="Add metadata"
                      [disabled]="busy()"
                      (click)="openFormFeature(null)"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                    </button>
                  }
                </div>
                @if (formFeatureEdit(); as feature) {
                  <div class="meta-edit">
                    <input
                      #formFeatureField
                      [value]="formFeatureKey()"
                      [attr.maxlength]="metaKeyMaxLength"
                      placeholder="Key"
                      aria-label="Metadata key"
                      (input)="formFeatureKey.set(inputValue($event))"
                      (keydown.enter)="saveFormFeature()"
                    />
                    <input
                      [value]="formFeatureValue()"
                      [attr.maxlength]="metaValueMaxLength"
                      placeholder="Value"
                      aria-label="Metadata value"
                      (input)="formFeatureValue.set(inputValue($event))"
                      (keydown.enter)="saveFormFeature()"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      [disabled]="busy() || !formFeatureKey().trim() || !formFeatureValue().trim()"
                      [attr.aria-label]="feature.previousKey ? 'Save metadata' : 'Add metadata'"
                      (click)="saveFormFeature()"
                    >
                      <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Cancel"
                      (click)="cancelFormFeature()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                }
                @if (entries(formFeatures()); as features) {
                  @if (features.length) {
                    <ul class="pills">
                      @for (entry of features; track entry.key) {
                        @if (formFeatureEdit()?.previousKey !== entry.key) {
                          <li>
                            <button
                              type="button"
                              [disabled]="busy()"
                              [attr.aria-label]="'Edit metadata ' + entry.key"
                              (click)="openFormFeature(entry.key)"
                            >
                              {{ entry.key }}: {{ entry.value }}
                            </button>
                            <button
                              type="button"
                              class="tag-remove"
                              [disabled]="busy()"
                              [attr.aria-label]="'Remove metadata ' + entry.key"
                              (click)="removeFormFeature(entry.key)"
                            >
                              ×
                            </button>
                          </li>
                        }
                      }
                    </ul>
                  }
                }
              </div>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() || !formDraft().trim()"
                  (click)="saveForm()"
                >
                  Save
                </button>
              </div>
            </section>
          </div>
        }

        @if (addFormFor() != null) {
          <div class="sheet-backdrop" (click)="closeAddForm($event)">
            <section
              class="sheet add-definition"
              role="dialog"
              aria-modal="true"
              aria-label="Add a form"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Add a form</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="askingForms() !== null"
                  (click)="addFormFor.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="add-choices">
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  [disabled]="askingForms() !== null"
                  (click)="addFormManually()"
                >
                  Write it yourself
                </button>
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  [disabled]="askingForms() !== null"
                  [attr.aria-busy]="askingForms() !== null ? true : null"
                  (click)="addFormWithAi()"
                >
                  Ask AI
                </button>
              </div>
              @if (error()) {
                <p class="error">{{ error() }}</p>
              }
            </section>
          </div>
        }

        @if (addExampleFor() != null) {
          <div class="sheet-backdrop" (click)="closeAddExample($event)">
            <section
              class="sheet add-definition"
              role="dialog"
              aria-modal="true"
              aria-label="Add an example"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Add an example</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="addExampleFor.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="add-choices">
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  (click)="addExampleManually()"
                >
                  Write it yourself
                </button>
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  (click)="addExampleWithAi()"
                >
                  Ask AI
                </button>
              </div>
            </section>
          </div>
        }

        @if (addDefinitionOpen()) {
          <div class="sheet-backdrop" (click)="closeAddDefinition($event)">
            <section
              class="sheet add-definition"
              role="dialog"
              aria-modal="true"
              aria-label="Add a definition"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Add a definition</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="asking()"
                  (click)="addDefinitionOpen.set(false)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="add-choices">
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  [disabled]="asking()"
                  (click)="addDefinitionManually()"
                >
                  Write it yourself
                </button>
                <button
                  type="button"
                  class="btn btn-secondary add-choice"
                  [disabled]="asking()"
                  [attr.aria-busy]="addingDefinitions() === 'missing' ? true : null"
                  (click)="addMissingDefinitions()"
                >
                  Add missing definitions
                </button>
              </div>
              <div class="add-example">
                <label class="field-label" for="definition-example">From an example</label>
                <div class="example-entry">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                    />
                    <path
                      d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                    />
                  </svg>
                  <textarea
                    id="definition-example"
                    rows="3"
                    [value]="definitionExample()"
                    [attr.maxlength]="exampleLengthMax"
                    [disabled]="asking()"
                    placeholder="A sentence that uses this word"
                    (input)="definitionExample.set(inputValue($event))"
                  ></textarea>
                </div>
                <button
                  type="button"
                  class="btn btn-primary add-choice"
                  [disabled]="asking() || !definitionExample().trim()"
                  [attr.aria-busy]="addingDefinitions() === 'example' ? true : null"
                  (click)="addDefinitionFromExample()"
                >
                  Add this definition
                </button>
              </div>
              @if (error()) {
                <p class="error">{{ error() }}</p>
              }
            </section>
          </div>
        }

        @if (modeOpen()) {
          <div class="sheet-backdrop" (click)="closeMode($event)">
            <section
              class="sheet mode-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Mode"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Mode</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="busy()"
                  (click)="modeOpen.set(false)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="mode-choices" role="radiogroup" aria-label="Mode">
                @for (mode of modes; track mode) {
                  <div
                    class="mode-column"
                    [style.--mode-color]="modeColor(mode).color"
                    [style.--mode-rgb]="modeColor(mode).rgb"
                  >
                    <button
                      type="button"
                      class="mode-choice"
                      [class.selected]="element().mode === mode"
                      [attr.aria-label]="modeLabel(mode)"
                      [disabled]="busy()"
                      [attr.aria-pressed]="element().mode === mode"
                      (click)="chooseMode(mode)"
                    >
                      <app-mode-icon [mode]="mode" />
                      <span>{{ modeLabel(mode) }}</span>
                    </button>
                    <app-mode-progress
                      [mode]="mode"
                      [succeeded]="0"
                      [goal]="readStepGoal(element().language)"
                      [labeled]="true"
                    />
                  </div>
                }
              </div>
            </section>
          </div>
        }

        @if (colorOpen()) {
          <div class="sheet-backdrop" (click)="closeHighlight($event)">
            <section
              class="sheet highlight-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Highlight color"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Highlight</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="busy()"
                  (click)="colorOpen.set(false)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div
                class="color-sv"
                [style.background]="colorSvBackground()"
                (pointerdown)="onColorPointer($event)"
                (pointermove)="onColorPointer($event)"
              >
                <span
                  class="color-sv-thumb"
                  [style.left.%]="colorSat() * 100"
                  [style.top.%]="(1 - colorVal()) * 100"
                  [style.background]="colorDraft()"
                ></span>
              </div>
              <input
                class="color-hue"
                type="range"
                min="0"
                max="360"
                step="1"
                aria-label="Hue"
                [value]="colorHue()"
                [disabled]="busy()"
                (input)="onHueInput($event)"
              />
              <div class="underline-styles">
                @for (style of highlightStyles; track style) {
                  <button
                    type="button"
                    class="underline-style"
                    [class.selected]="styleDraft() === style"
                    [style.--highlight-color]="colorDraft()"
                    [style.--highlight-style]="style"
                    [disabled]="busy()"
                    [attr.aria-label]="style + ' underline'"
                    [attr.aria-pressed]="styleDraft() === style"
                    (click)="styleDraft.set(style)"
                  >
                    Aa
                  </button>
                }
              </div>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="busy() || !canResetHighlight()"
                  (click)="resetHighlight()"
                >
                  Reset
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="busy()"
                  (click)="colorOpen.set(false)"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() || !highlightDirty()"
                  (click)="saveHighlight()"
                >
                  Save
                </button>
              </div>
            </section>
          </div>
        }

        @if (confirm(); as pending) {
          <div class="sheet-backdrop" (click)="closeSheet($event)">
            <section
              class="sheet confirm"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="confirmTitle(pending)"
              (click)="$event.stopPropagation()"
            >
              <h3>{{ confirmTitle(pending) }}</h3>
              <p class="hint">
                {{
                  pending.kind === 'element'
                    ? 'This element will be removed.'
                    : 'This will be removed.'
                }}
              </p>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="busy()"
                  (click)="confirm.set(null)"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  [disabled]="busy()"
                  (click)="confirmDelete()"
                >
                  Delete
                </button>
              </div>
            </section>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
    }

    .backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(100%, 42rem);
      height: min(90dvh, calc(100dvh - 2.5rem));
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }

    header,
    .sheet-head,
    .section-heading,
    .sheet-actions {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    header,
    .sheet-head,
    .section-heading {
      justify-content: space-between;
    }

    header {
      flex-direction: column;
      align-items: stretch;
      gap: 0.7rem;
      padding: 0.9rem 1.15rem;
      border-bottom: 1px solid var(--border);
    }

    header > .header-actions {
      justify-content: flex-end;
    }

    .color-sv {
      position: relative;
      height: 8rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      touch-action: none;
      cursor: crosshair;
    }

    .color-sv-thumb {
      position: absolute;
      width: 0.9rem;
      height: 0.9rem;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .color-hue {
      width: 100%;
      height: 0.85rem;
      margin: 0;
      appearance: none;
      border-radius: 999px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      cursor: pointer;
    }

    .color-hue::-webkit-slider-thumb {
      appearance: none;
      width: 1rem;
      height: 1rem;
      border: 2px solid #fff;
      border-radius: 50%;
      background: transparent;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    }

    .underline-styles {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.35rem;
    }

    .underline-style {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      cursor: pointer;
      padding: 0.45rem 0;
      text-decoration-line: underline;
      text-decoration-style: var(--highlight-style, solid);
      text-decoration-color: var(--highlight-color, currentColor);
      text-underline-offset: 0.18em;
    }

    .underline-style.selected {
      box-shadow:
        0 0 0 2px var(--surface),
        0 0 0 4px var(--accent);
    }

    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-width: 0;
    }

    .title-row h2,
    .title-edit,
    .title-main {
      flex: 1;
      min-width: 0;
    }

    .title-main {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    .title-main h2 {
      flex: 0 1 auto;
    }

    .mode-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.8rem;
      height: 1.8rem;
      border: 0;
      padding: 0;
      border-radius: 0.4rem;
      background: transparent;
      cursor: pointer;
    }

    .mode-btn:hover:not(:disabled) {
      background: rgba(139, 144, 165, 0.16);
    }

    .mode-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .mode-btn app-mode-icon {
      width: 1.25rem;
      height: 1.25rem;
    }

    .mode-control {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: none;
      gap: 0.02rem;
    }

    .mode-sheet {
      width: min(100%, 26rem);
    }

    .mode-choices {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.55rem;
    }

    .mode-column {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }

    .mode-choice {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
      width: 100%;
      margin: 0;
      padding: 0.7rem 0.3rem 0.65rem;
      border: 1px solid rgba(var(--mode-rgb), 0.45);
      border-radius: 14px;
      background: var(--surface-2);
      color: var(--mode-color);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
    }

    .mode-choice app-mode-icon {
      width: 4.4rem;
      height: 4.4rem;
    }

    .mode-choice.selected {
      border-color: var(--mode-color);
      background: rgba(var(--mode-rgb), 0.14);
      box-shadow: inset 0 0 0 1px var(--mode-color);
    }

    .mode-choice:disabled {
      cursor: default;
    }

    .title-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .title-edit input {
      flex: 1;
      min-width: 0;
      font: inherit;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    p.equivalents .sep {
      margin-inline: 0.45rem;
      color: var(--text-muted);
    }

    .equivalent-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .equivalent-choices button {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      padding: 0.28rem 0.7rem;
      cursor: pointer;
    }

    .equivalent-choices button.selected {
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
    }

    .equivalent-choices button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .equivalent-block {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      border-radius: 12px;
    }

    .equivalent-block.missing {
      margin-inline: -0.55rem;
      padding: 0.55rem;
      background: color-mix(in srgb, var(--danger) 12%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 55%, transparent);
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      min-width: 0;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    .close,
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .close {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
    }

    .close:hover,
    .icon-btn:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .icon-btn.highlight-btn,
    .icon-btn.highlight-btn:hover:not(:disabled) {
      color: var(--swatch, var(--accent));
    }

    .icon-btn {
      position: relative;
      width: 1.8rem;
      height: 1.8rem;
      border-radius: 0.4rem;
    }

    .notify {
      position: absolute;
      top: 0.12rem;
      right: 0.12rem;
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 999px;
      background: var(--danger);
      box-shadow: 0 0 0 2px var(--surface);
    }

    .icon-btn:disabled,
    .form-chip button:disabled,
    .pills button:disabled,
    .tag-remove:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .icon-btn.active,
    .icon-btn.active:hover:not(:disabled) {
      color: var(--accent-text);
      background: var(--accent-soft);
    }

    .icon-btn.copied,
    .icon-btn.copied:hover:not(:disabled) {
      color: #7ddea8;
      background: rgba(125, 222, 168, 0.14);
    }

    .icon-btn.danger:hover:not(:disabled) {
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }

    .icon-btn svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .icon-btn svg .solid {
      fill: currentColor;
      stroke: none;
    }

    .item-actions,
    .item-actions-move,
    .item-actions-main {
      display: flex;
      align-items: center;
      gap: 0.15rem;
      min-width: 0;
    }

    .item-actions {
      justify-content: flex-end;
    }

    .item-actions-move {
      margin-right: auto;
    }

    .lookup-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.35rem;
      margin-left: auto;
    }

    .lookup-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      height: 2rem;
      padding: 0 0.7rem 0 0.5rem;
      border: 1px solid rgba(var(--accent-rgb), 0.45);
      border-radius: 999px;
      background: var(--surface);
      color: var(--accent-text);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      line-height: 1;
      cursor: pointer;
    }

    .lookup-chip svg {
      display: block;
      width: 0.9rem;
      height: 0.9rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .lookup-chip:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 1rem 1.15rem 1.25rem;
    }

    .delete-element {
      align-self: stretch;
      gap: 0.45rem;
      width: 100%;
      margin-top: auto;
    }

    .delete-element svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    h3 {
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1;
      text-transform: uppercase;
    }

    h3.section-title {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    h3.section-title svg {
      display: block;
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
      fill: none;
      stroke: var(--accent-text);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .empty,
    .hint,
    .error {
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    .error {
      color: var(--danger);
    }

    .definitions,
    .examples,
    .forms,
    .pills {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definitions {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .sense {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .suggestion {
      border-style: dashed;
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .suggestion .passage {
      color: var(--accent-text);
    }

    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      height: 1.7rem;
      padding: 0 0.5rem;
      border: 1px solid rgba(139, 144, 165, 0.4);
      border-radius: 0.35rem;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.72rem;
      line-height: 1;
      white-space: nowrap;
    }

    .sense-meta li app-reveal {
      line-height: 1;
    }

    .sense-meta-key {
      margin-right: 0.35rem;
      font-weight: 600;
    }

    .sense-frequency {
      align-items: center;
      gap: 0.28rem;
    }

    .sense-frequency app-frequency-gem {
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
    }

    .frequency-field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .frequency-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .frequency-choice {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin: 0;
      padding: 0.2rem 0.5rem 0.2rem 0.35rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.72rem;
      font-weight: 650;
      cursor: pointer;
    }

    .frequency-choice app-frequency-gem {
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
    }

    .frequency-choice.selected {
      border-color: rgba(var(--accent-rgb), 0.75);
      color: var(--text);
    }

    .frequency-choice:disabled {
      cursor: default;
    }

    .sense-meta li.sense-equivalent {
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
      color: var(--accent-text);
      font-weight: 650;
    }

    .suggestion .sense-meta li {
      border-color: var(--accent-border);
      color: var(--accent-text);
    }

    .add-suggestion {
      align-self: flex-end;
    }

    .sense-main {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .sense-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .passage {
      white-space: pre-wrap;
    }

    .linguagem-highlighted {
      background: transparent;
      color: inherit;
      border-bottom: none;
      text-decoration-line: underline;
      text-decoration-style: var(--highlight-style, solid);
      text-decoration-color: var(--highlight-color, #6c63ff);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
    }

    button.linguagem-highlighted {
      display: inline;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
      text-align: inherit;
    }

    .linguagem-highlighted--current {
      text-decoration: none;
      border-radius: 0.18em;
      padding: 0 0.12em;
      background: color-mix(in srgb, var(--highlight-color, #6c63ff) 32%, transparent);
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }

    .collision {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .collision button {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      padding: 0.28rem 0.7rem;
      cursor: pointer;
    }

    .sense > .group {
      margin-top: 0.2rem;
      padding-top: 0.85rem;
      border-top: 1px solid rgba(139, 144, 165, 0.28);
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .forms {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .forms li {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }

    .form-chip,
    .pills li {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .form-chip button,
    .pills button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .form-chip > button:first-child,
    .pills li > button:first-child,
    .pills li > span {
      padding: 0.2rem 0.15rem 0.2rem 0.55rem;
    }

    .pills li > span {
      padding-inline-end: 0.55rem;
    }

    .tag-remove {
      padding: 0.2rem 0.45rem 0.2rem 0.15rem;
      line-height: 1;
    }

    .form-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .form-edit input {
      flex: 1;
    }

    .examples {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .examples li {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .examples li.saved-example {
      flex-direction: column;
      align-items: stretch;
      gap: 0.35rem;
    }

    .example-quote {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
      padding: 0.1rem 0 0.1rem 0.85rem;
      border-left: 3px solid rgba(var(--accent-rgb), 0.45);
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .example-quote .passage {
      margin: 0;
    }

    .example-quote .equivalents {
      font-size: 0.82rem;
    }

    .meta {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .meta-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .meta-edit input {
      flex: 1;
      min-width: 0;
    }

    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .sheet-backdrop {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem;
      background: rgba(8, 10, 16, 0.55);
    }

    .add-definition {
      gap: 0.75rem;
    }

    .add-choices,
    .add-example {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .example-entry {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
    }

    .example-entry svg,
    .example-line svg {
      display: block;
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
      fill: none;
      stroke: var(--accent-text);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .example-entry svg {
      margin-top: 0.65rem;
    }

    .example-entry textarea {
      flex: 1;
      min-width: 0;
    }

    .example-line {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .example-line svg {
      margin-top: 0.15rem;
    }

    .add-choice {
      width: 100%;
      border-radius: 12px;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      width: min(100%, 32rem);
      max-height: 100%;
      overflow: auto;
      box-sizing: border-box;
      padding: 0.9rem 1rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
    }

    .engineer-sheet {
      overflow: hidden;
    }

    .engineer-sheet textarea {
      flex: none;
      height: 5.6rem;
      resize: none;
    }

    .engineer-forms,
    .engineer-words {
      max-height: 9rem;
      overflow: auto;
    }

    .definition-layer {
      overflow: hidden;
      align-items: stretch;
      justify-content: stretch;
      padding: 0;
      background: transparent;
    }

    .definition-engineer {
      flex: 1 1 auto;
      width: 100%;
      max-width: none;
      height: auto;
      min-height: 0;
      overflow: hidden;
      border: 0;
      border-radius: inherit;
      box-shadow: none;
      padding: 0.9rem 1.15rem 1rem;
    }

    .definition-engineer textarea {
      flex: none;
      height: auto;
      resize: none;
    }

    .definition-draft {
      display: flex;
      flex: none;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
      padding: 0.7rem 0.75rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .definition-engineer .sheet-title {
      flex: 1;
      min-width: 0;
    }

    .definition-engineer .sheet-title h3,
    .definition-engineer .sheet-title .hint {
      margin: 0;
    }

    .definition-engineer .sheet-title .hint {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .definition-engineer .sheet-actions,
    .definition-engineer .error,
    .definition-engineer .definition-draft {
      flex: none;
    }

    .definition-engineer .staged-wording {
      max-height: 12rem;
      overflow: auto;
    }

    .definition-engineer .section-heading .btn {
      padding: 0.4rem 0.8rem;
      font-size: 0.8125rem;
    }

    .related-block {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.45rem;
      min-width: 0;
      min-height: 0;
    }

    .definition-engineer .engineer-words {
      flex: 1 1 auto;
      min-height: 0;
      max-height: none;
    }

    .engineer-words .equivalent-choices li {
      max-width: 100%;
      min-width: 0;
    }

    .related-chip {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      max-width: 100%;
      white-space: normal;
      text-align: left;
      line-height: 1.35;
    }

    .related-word {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .engineer-words .relation {
      color: var(--text-muted);
      font-size: 0.72rem;
    }

    .engineer-words button.selected .relation {
      color: var(--accent-text);
    }

    .staged-wording {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .staged-wording li {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 0.65rem 0.75rem;
      border: 1px dashed var(--accent-border);
      border-radius: var(--radius);
      background: var(--accent-soft);
    }

    .staged-wording .passage {
      margin: 0;
      color: var(--accent-text);
    }

    .sheet h3 {
      color: var(--text);
      font-size: 1rem;
      letter-spacing: -0.02em;
      text-transform: none;
    }

    .field-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    label,
    .field-label {
      font-size: 0.78rem;
      font-weight: 650;
      color: var(--text-muted);
    }

    .forms-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      padding: 0;
      cursor: pointer;
    }

    .forms-toggle:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .forms-toggle-side {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      font-weight: 500;
    }

    .forms-toggle-side span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .forms-toggle svg {
      width: 1rem;
      height: 1rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .forms-toggle svg.open {
      transform: rotate(180deg);
    }

    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      resize: vertical;
    }

    .sheet-actions {
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid color-mix(in srgb, var(--danger) 55%, transparent);
    }

    .btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }
  `,
})
export class ElementModal {
  readonly element = input.required<StoredElement>();
  readonly collection = input<StoredElement[]>([]);
  readonly canGoBack = input(false);
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly deleted = output<void>();
  readonly visit = output<string>();
  readonly back = output<void>();
  readonly addSelection = output<string>();
  readonly addPrepared = output<PreparedElement>();

  readonly formMaxLength = FORM_MAX_LENGTH;
  readonly metaKeyMaxLength = META_KEY_MAX_LENGTH;
  readonly metaValueMaxLength = META_VALUE_MAX_LENGTH;
  readonly exampleInstructionMax = MAX_EXAMPLE_INSTRUCTION;
  readonly highlightStyles = HIGHLIGHT_STYLES;
  readonly modeLabel = elementModeLabel;
  readonly modeColor = modeColor;
  readonly readStepGoal = readStepGoal;
  readonly modes: readonly ElementMode[] = [1, 2, 3];
  readonly frequencies = DEFINITION_FREQUENCIES;
  readonly frequencyLabel = definitionFrequencyLabel;
  readonly frequencyDraft = signal<DefinitionFrequency>('common');
  readonly exampleLengthMax = MAX_EXAMPLE_LENGTH;
  readonly definitionInstructionMax = MAX_DEFINITION_INSTRUCTION;
  readonly relatedPickMax = MAX_RELATED_PICKS;
  readonly parsePassage = parsePassage;
  readonly editor = signal<Editor | null>(null);
  readonly equivalentDraft = signal('');
  readonly equivalentIdDraft = signal<string | null>(null);
  readonly textDraft = signal('');
  readonly sheetTranslations = signal<PassageTranslation[]>([]);
  readonly translating = signal(false);
  readonly askingEquivalent = signal(false);
  readonly translationsOpen = signal(false);
  readonly titleTranslationDraft = signal('');
  readonly translationEditId = signal<string | null>(null);
  readonly sheetError = signal('');
  readonly formEdit = signal<FormEdit | null>(null);
  readonly formDraft = signal('');
  readonly formError = signal('');
  readonly formFeatures = signal<ElementMetadata>({});
  readonly formFeatureEdit = signal<MetadataEdit | null>(null);
  readonly formFeatureKey = signal('');
  readonly formFeatureValue = signal('');
  readonly metaEdit = signal<MetadataEdit | null>(null);
  readonly metaKey = signal('');
  readonly metaValue = signal('');
  readonly sheetMetadata = signal<ElementMetadata>({});
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly passageSelection = signal<PassageSelection | null>(null);
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly asking = signal(false);
  readonly addingSelection = signal(false);
  readonly titleEdit = signal(false);
  readonly titleDraft = signal('');
  readonly titleError = signal('');
  readonly addDefinitionOpen = signal(false);
  readonly addExampleFor = signal<number | null>(null);
  readonly addFormFor = signal<number | null>(null);
  readonly addingDefinitions = signal<'missing' | 'example' | null>(null);
  readonly definitionExample = signal('');
  readonly askingForms = signal<number | null>(null);
  readonly askingExamples = signal<number | null>(null);
  readonly askingRelated = signal<number | null>(null);
  readonly askingWording = signal<number | null>(null);
  readonly suggestions = signal<DefinitionSuggestion[]>([]);
  readonly exampleSuggestions = signal<Record<string, ExampleSuggestion[]>>({});
  readonly wordingSuggestions = signal<Record<string, WordingSuggestion[]>>({});
  readonly exampleEngineer = signal<ExampleEngineer | null>(null);
  readonly definitionEngineer = signal<DefinitionEngineer | null>(null);
  readonly modeOpen = signal(false);
  readonly colorOpen = signal(false);
  readonly colorHue = signal(0);
  readonly colorSat = signal(1);
  readonly colorVal = signal(1);
  readonly colorDraft = signal(DEFAULT_HIGHLIGHT_COLOR);
  readonly styleDraft = signal<HighlightStyle>('solid');
  readonly engineerGloss = signal('');
  readonly engineerEnglish = signal('');
  readonly error = signal('');
  readonly speaking = signal<string | null>(null);
  readonly copied = signal<string | null>(null);

  private translateTicket = 0;
  private equivalentTicket = 0;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private exampleJob = 0;
  private relatedJob = 0;
  private wordingJob = 0;
  private trackedElementId = '';
  private engineerDrafts = new Map<string, EngineerDraft>();
  private definitionEngineerDrafts = new Map<string, DefinitionEngineerDraft>();
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly draftField = viewChild<ElementRef<HTMLTextAreaElement>>('draftField');
  private readonly formField = viewChild<ElementRef<HTMLInputElement>>('formField');
  private readonly formFeatureField = viewChild<ElementRef<HTMLInputElement>>('formFeatureField');
  private readonly metaKeyField = viewChild<ElementRef<HTMLInputElement>>('metaKeyField');
  private readonly translationField = viewChild<ElementRef<HTMLInputElement>>('translationField');
  private readonly titleField = viewChild<ElementRef<HTMLInputElement>>('titleField');

  constructor() {
    inject(DestroyRef).onDestroy(() => stopSpeaking());
    effect(() => {
      const id = this.element().id;
      if (id === this.trackedElementId) return;
      this.trackedElementId = id;
      this.stopSpeech();
      this.clearCopied();
      this.editor.set(null);
      this.formEdit.set(null);
      this.formError.set('');
      this.formFeatureEdit.set(null);
      this.metaEdit.set(null);
      this.collision.set(null);
      this.passageSelection.set(null);
      this.addingSelection.set(false);
      this.titleEdit.set(false);
      this.titleError.set('');
      this.confirm.set(null);
      this.askingForms.set(null);
      this.askingExamples.set(null);
      this.askingRelated.set(null);
      this.askingWording.set(null);
      this.exampleEngineer.set(null);
      this.definitionEngineer.set(null);
      this.addDefinitionOpen.set(false);
      this.addExampleFor.set(null);
      this.addFormFor.set(null);
      this.modeOpen.set(false);
      this.colorOpen.set(false);
      this.definitionExample.set('');
      this.addingDefinitions.set(null);
      this.equivalentTicket += 1;
      this.askingEquivalent.set(false);
      this.dismissTranslations();
      this.engineerDrafts.clear();
      this.definitionEngineerDrafts = readRelatedDrafts(id);
      void this.commitStoredExamples(id);
      this.loadWordingSuggestions(id);
      const saved = new Set(
        this.element().definitions.map((definition) =>
          parsePassage(definition.text).text.trim().toLowerCase(),
        ),
      );
      const stored = readDefinitionSuggestions(id).filter((suggestion) => {
        const gloss = parsePassage(suggestion.text).text.trim().toLowerCase();
        return gloss && !saved.has(gloss);
      });
      this.suggestions.set(stored);
      if (stored.length !== readDefinitionSuggestions(id).length) {
        writeDefinitionSuggestions(id, stored);
      }
    });
    const stopWatching = watchDefinitionSuggestions((elementId) => {
      if (elementId !== this.trackedElementId) return;
      this.suggestions.set(readDefinitionSuggestions(elementId));
    });
    const stopWatchingExamples = watchExampleSuggestions((elementId) => {
      if (elementId !== this.trackedElementId) return;
      this.exampleSuggestions.set(readExampleSuggestions(elementId));
    });
    const stopWatchingWording = watchWordingSuggestions((elementId) => {
      if (elementId !== this.trackedElementId) return;
      this.wordingSuggestions.set(readWordingSuggestions(elementId));
    });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('selectionchange', this.syncPassageSelection);
    document.addEventListener('pointerdown', this.onSelectionPointerDown, true);
    document.addEventListener('pointerup', this.syncPassageSelection, true);
    inject(DestroyRef).onDestroy(() => {
      stopWatching();
      stopWatchingExamples();
      stopWatchingWording();
      this.clearCopied();
      document.removeEventListener('selectionchange', this.syncPassageSelection);
      document.removeEventListener('pointerdown', this.onSelectionPointerDown, true);
      document.removeEventListener('pointerup', this.syncPassageSelection, true);
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.titleEdit()) {
      if (!this.busy()) this.cancelTitle();
      return;
    }
    if (this.modeOpen()) {
      if (!this.busy()) this.modeOpen.set(false);
      return;
    }
    if (this.colorOpen()) {
      if (!this.busy()) this.colorOpen.set(false);
      return;
    }
    if (this.addFormFor() != null) {
      if (this.askingForms() === null) this.addFormFor.set(null);
      return;
    }
    if (this.addExampleFor() != null) {
      this.addExampleFor.set(null);
      return;
    }
    if (this.addDefinitionOpen()) {
      if (!this.asking()) this.addDefinitionOpen.set(false);
      return;
    }
    if (this.confirm()) {
      this.confirm.set(null);
      return;
    }
    if (this.metaEdit()) {
      this.metaEdit.set(null);
      return;
    }
    if (this.editor()) {
      this.editor.set(null);
      return;
    }
    if (this.translationsOpen()) {
      this.dismissTranslations();
      return;
    }
    if (this.formFeatureEdit()) {
      this.formFeatureEdit.set(null);
      return;
    }
    if (this.formEdit()) {
      if (!this.busy()) this.cancelForm();
      return;
    }
    if (this.exampleEngineer()) {
      this.closeExampleEngineer();
      return;
    }
    if (this.definitionEngineer()) {
      this.closeDefinitionEngineer();
      return;
    }
    if (this.canGoBack()) {
      if (!this.busy()) this.back.emit();
      return;
    }
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  closeSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    if (this.confirm()) this.confirm.set(null);
    else this.editor.set(null);
  }

  openTitle(): void {
    if (this.aiBusy() || this.titleEdit()) return;
    this.titleError.set('');
    this.titleDraft.set(this.element().title);
    this.titleEdit.set(true);
    setTimeout(() => {
      const field = this.titleField()?.nativeElement;
      field?.focus();
      field?.select();
    });
  }

  cancelTitle(): void {
    this.titleEdit.set(false);
    this.titleError.set('');
  }

  async saveTitle(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.titleEdit() || this.busy()) return;
    const name = this.titleDraft().replace(/\s+/g, ' ').trim().slice(0, FORM_MAX_LENGTH);
    const element = this.element();
    if (!name) {
      this.titleError.set('A title is required.');
      return;
    }
    if (name === element.title) {
      this.cancelTitle();
      return;
    }
    const taken = this.collection().some(
      (item) => item.id !== element.id && sameTitle(item.title, name),
    );
    if (taken) {
      this.titleError.set('That title is already there.');
      return;
    }
    const definitions = this.copyDefinitions().map((definition) => ({
      ...definition,
      forms: retitleForms(definition.forms, element.title, name),
    }));
    const editing = this.formEdit();
    this.busy.set(true);
    this.titleError.set('');
    try {
      const saved = await saveElement({ ...element, title: name, definitions });
      if (this.element().id !== element.id) return;
      if (editing?.originalText && sameTitle(editing.originalText, element.title)) {
        this.formEdit.set({ ...editing, originalText: name });
        if (sameTitle(this.formDraft(), element.title)) this.formDraft.set(name);
      }
      this.titleEdit.set(false);
      this.changed.emit(saved);
    } catch {
      if (this.element().id === element.id) this.titleError.set('Could not save this element.');
    } finally {
      if (this.element().id === element.id) this.busy.set(false);
    }
  }

  shownTitle(title = this.element().title): string {
    return displayTitle(title, this.element().language);
  }

  headerEquivalents(): string[] {
    return this.element().equivalents.map((item) => item.text);
  }

  openTranslations(): void {
    if (this.busy()) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.confirm.set(null);
    this.titleTranslationDraft.set('');
    this.translationEditId.set(null);
    this.translationsOpen.set(true);
    setTimeout(() => this.translationField()?.nativeElement.focus());
  }

  dismissTranslations(): void {
    this.translationsOpen.set(false);
    this.titleTranslationDraft.set('');
    this.translationEditId.set(null);
  }

  closeTranslations(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.dismissTranslations();
  }

  editTitleTranslation(id: string): void {
    const item = this.element().equivalents.find((entry) => entry.id === id);
    if (!item || this.busy()) return;
    this.translationEditId.set(id);
    this.titleTranslationDraft.set(item.text);
    setTimeout(() => this.translationField()?.nativeElement.focus());
  }

  async saveTitleTranslation(): Promise<void> {
    if (this.busy()) return;
    const text = this.titleTranslationDraft().trim();
    if (!text) return;
    const editId = this.translationEditId();
    const equivalents = this.element().equivalents.map((item) => ({ ...item }));
    const definitions = this.copyDefinitions();
    if (editId) {
      const current = equivalents.find((item) => item.id === editId);
      if (!current) return;
      const duplicate = equivalents.find((item) => item.id !== editId && item.text === text);
      if (duplicate) {
        for (const definition of definitions) {
          if (definition.equivalentId === editId) definition.equivalentId = duplicate.id;
        }
        const next = equivalents.filter((item) => item.id !== editId);
        if (!(await this.persist(definitions, next))) return;
      } else if (current.text !== text) {
        current.text = text;
        if (!(await this.persist(definitions, equivalents))) return;
      }
    } else {
      const linked = assignEquivalent(equivalents, text);
      if (linked.equivalents.length === equivalents.length) {
        this.titleTranslationDraft.set('');
        return;
      }
      if (!(await this.persist(definitions, linked.equivalents))) return;
    }
    this.titleTranslationDraft.set('');
    this.translationEditId.set(null);
  }

  async removeTitleTranslation(id: string): Promise<void> {
    if (this.busy() || !this.element().equivalents.some((item) => item.id === id)) return;
    const equivalents = this.element().equivalents.filter((item) => item.id !== id);
    const definitions = this.copyDefinitions().map((definition) =>
      definition.equivalentId === id ? { ...definition, equivalentId: null } : definition,
    );
    if (!(await this.persist(definitions, equivalents))) return;
    if (this.translationEditId() === id) {
      this.translationEditId.set(null);
      this.titleTranslationDraft.set('');
    }
    if (this.equivalentIdDraft() === id) this.equivalentIdDraft.set(null);
  }

  equivalentSelected(id: string): boolean {
    const typed = this.equivalentDraft().trim();
    if (typed) {
      return this.element().equivalents.some((item) => item.id === id && item.text === typed);
    }
    return this.equivalentIdDraft() === id;
  }

  chooseEquivalent(id: string): void {
    const selected = this.equivalentSelected(id);
    this.equivalentDraft.set('');
    this.equivalentIdDraft.set(selected ? null : id);
  }

  equivalentMissing(): boolean {
    return !this.equivalentIdDraft() && !this.equivalentDraft().trim();
  }

  canAskEquivalent(): boolean {
    return (
      this.element().language !== 'en' &&
      this.textDraft().trim().length > 0 &&
      !this.translating() &&
      !this.askingEquivalent() &&
      !this.aiBusy()
    );
  }

  async askEquivalent(): Promise<void> {
    if (!this.canAskEquivalent()) return;
    const element = this.element();
    const definition = this.textDraft().trim();
    const english = this.sheetTranslations().find((item) => item.language === 'en')?.text ?? '';
    const ticket = ++this.equivalentTicket;
    this.askingEquivalent.set(true);
    this.sheetError.set('');
    try {
      const translation = await generateEquivalent({
        lemma: element.title,
        sourceLang: element.language,
        definition,
        english,
      });
      if (ticket !== this.equivalentTicket) return;
      if (!translation) {
        this.sheetError.set('Could not find an equivalent.');
        return;
      }
      const folded = translation.toLocaleLowerCase();
      const match = this.element().equivalents.find(
        (item) => item.text.toLocaleLowerCase() === folded,
      );
      if (match) {
        this.equivalentDraft.set('');
        this.equivalentIdDraft.set(match.id);
      } else {
        this.equivalentDraft.set(translation);
        this.equivalentIdDraft.set(null);
      }
    } catch {
      if (ticket !== this.equivalentTicket) return;
      this.sheetError.set('Could not find an equivalent.');
    } finally {
      if (ticket === this.equivalentTicket) this.askingEquivalent.set(false);
    }
  }

  equivalentText(definition: ElementDefinition): string {
    const id = definition.equivalentId;
    if (!id) return '';
    return this.element().equivalents.find((item) => item.id === id)?.text ?? '';
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }

  /** First letter of a metadata label, leaving the rest of the wording alone. */
  label(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  sheetTitle(editor: Editor): string {
    if (editor.kind === 'definition') {
      return editor.index == null ? 'Add a definition' : 'Edit definition';
    }
    return editor.exampleIndex == null ? 'Add an example' : 'Edit example';
  }

  aiBusy(): boolean {
    return (
      this.busy() ||
      this.asking() ||
      this.addingSelection() ||
      this.askingForms() !== null ||
      this.askingExamples() !== null ||
      this.askingRelated() !== null ||
      this.askingWording() !== null
    );
  }

  openAddDefinition(): void {
    if (this.aiBusy()) return;
    this.error.set('');
    this.definitionExample.set('');
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.confirm.set(null);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.dismissTranslations();
    this.addDefinitionOpen.set(true);
  }

  openAddExample(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.confirm.set(null);
    this.addDefinitionOpen.set(false);
    this.addFormFor.set(null);
    this.dismissTranslations();
    this.addExampleFor.set(index);
  }

  openAddForm(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.error.set('');
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.confirm.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.dismissTranslations();
    this.addFormFor.set(index);
  }

  closeAddForm(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.askingForms() !== null) return;
    this.addFormFor.set(null);
  }

  addFormManually(): void {
    const index = this.addFormFor();
    if (index == null || this.askingForms() !== null) return;
    this.addFormFor.set(null);
    this.openForm(index);
  }

  async addFormWithAi(): Promise<void> {
    const index = this.addFormFor();
    if (index == null || this.aiBusy()) return;
    await this.askForms(index);
    if (!this.error() && this.addFormFor() === index) this.addFormFor.set(null);
  }

  closeAddExample(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.addExampleFor.set(null);
  }

  addExampleManually(): void {
    const index = this.addExampleFor();
    if (index == null) return;
    this.addExampleFor.set(null);
    this.openExample(index, null);
  }

  addExampleWithAi(): void {
    const index = this.addExampleFor();
    if (index == null) return;
    this.addExampleFor.set(null);
    this.openExampleEngineer(index);
  }

  closeAddDefinition(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.asking()) return;
    this.addDefinitionOpen.set(false);
  }

  addDefinitionManually(): void {
    if (this.asking()) return;
    this.addDefinitionOpen.set(false);
    this.openDefinition(null);
  }

  async addMissingDefinitions(): Promise<void> {
    if (this.aiBusy() || !this.element().title.trim()) return;
    this.addingDefinitions.set('missing');
    try {
      await this.askDefinitions();
      if (!this.error()) this.addDefinitionOpen.set(false);
    } finally {
      this.addingDefinitions.set(null);
    }
  }

  async addDefinitionFromExample(): Promise<void> {
    if (this.aiBusy()) return;
    const example = this.definitionExample().trim().slice(0, MAX_EXAMPLE_LENGTH);
    const element = this.element();
    const title = element.title.trim();
    if (!example || !title) return;
    this.addingDefinitions.set('example');
    this.asking.set(true);
    this.error.set('');
    try {
      const sense = await generateDefinitionFromExample({
        language: element.language,
        title,
        example,
        existingDefinitions: [
          ...element.definitions.map((definition) => ({
            text: definition.text,
            metadata: definition.metadata,
            frequency: definition.frequency,
          })),
          ...this.suggestions().map((suggestion) => ({
            text: suggestion.text,
            metadata: suggestion.metadata,
            frequency: suggestion.frequency,
          })),
        ],
      });
      if (this.element().id !== element.id) return;
      if (!sense) {
        this.error.set('Could not write a definition from that example.');
        return;
      }
      const current = this.suggestions();
      const seen = new Set(
        [
          ...element.definitions.map((definition) => definition.text),
          ...current.map((item) => item.text),
        ].map((text) => parsePassage(text).text.trim().toLowerCase()),
      );
      const key = parsePassage(sense.text).text.trim().toLowerCase();
      if (!key || seen.has(key)) {
        this.error.set('That sense is already here.');
        return;
      }
      this.replaceSuggestions(element.id, [...current, { ...sense, example }]);
      this.definitionExample.set('');
      this.addDefinitionOpen.set(false);
    } catch {
      if (this.element().id === element.id) {
        this.error.set('Could not write a definition from that example.');
      }
    } finally {
      if (this.element().id === element.id) this.asking.set(false);
      this.addingDefinitions.set(null);
    }
  }

  async askDefinitions(): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.element();
    const title = element.title.trim();
    if (!title) return;
    this.asking.set(true);
    this.error.set('');
    try {
      const senses = await generateDefinitions({
        language: element.language,
        title,
        existingDefinitions: [
          ...element.definitions.map((definition) => ({
            text: definition.text,
            metadata: definition.metadata,
            frequency: definition.frequency,
          })),
          ...this.suggestions().map((suggestion) => ({
            text: suggestion.text,
            metadata: suggestion.metadata,
            frequency: suggestion.frequency,
          })),
        ],
      });
      const current =
        this.element().id === element.id
          ? this.suggestions()
          : readDefinitionSuggestions(element.id);
      const seen = new Set(
        [
          ...element.definitions.map((definition) => definition.text),
          ...current.map((item) => item.text),
        ].map((text) => parsePassage(text).text.trim().toLowerCase()),
      );
      const next = senses.filter((sense) => {
        const key = parsePassage(sense.text).text.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!next.length) {
        if (this.element().id === element.id) this.error.set('No further definitions.');
        return;
      }
      this.replaceSuggestions(element.id, [...current, ...next]);
    } catch {
      if (this.element().id === element.id) this.error.set('Could not ask for definitions.');
    } finally {
      if (this.element().id === element.id) this.asking.set(false);
    }
  }

  dismissSuggestion(index: number): void {
    if (this.busy()) return;
    this.replaceSuggestions(
      this.element().id,
      this.suggestions().filter((_, at) => at !== index),
    );
  }

  async addSuggestion(index: number): Promise<void> {
    if (this.aiBusy()) return;
    const suggestion = this.suggestions()[index];
    if (!suggestion) return;
    const element = this.element();
    const created: ElementDefinition = {
      text: suggestion.text,
      equivalentId: null,
      forms: [],
      examples: suggestion.example ? [{ text: suggestion.example, metadata: {} }] : [],
      metadata: { ...suggestion.metadata },
      frequency: suggestion.frequency,
    };
    const definitions = [created, ...this.copyDefinitions()];
    if (!(await this.persist(definitions, element.equivalents))) return;
    this.replaceSuggestions(
      element.id,
      this.suggestions().filter((item) => item !== suggestion),
    );
    this.shiftDefinitionIndexes(1);
  }

  private replaceSuggestions(elementId: string, list: DefinitionSuggestion[]): void {
    writeDefinitionSuggestions(elementId, list);
    if (this.element().id === elementId) this.suggestions.set(list);
  }

  private stopSpeech(): void {
    stopSpeaking();
    this.speaking.set(null);
  }

  private swapDefinitionIndexes(from: number, to: number): void {
    const map = (index: number): number => (index === from ? to : index === to ? from : index);
    const editing = this.formEdit();
    if (editing) this.formEdit.set({ ...editing, definitionIndex: map(editing.definitionIndex) });
    const editor = this.editor();
    if (editor?.kind === 'definition' && editor.index != null) {
      this.editor.set({ kind: 'definition', index: map(editor.index) });
    }
    if (editor?.kind === 'example') {
      this.editor.set({ ...editor, definitionIndex: map(editor.definitionIndex) });
    }
    const pending = this.confirm();
    if (pending?.kind === 'definition') {
      this.confirm.set({ kind: 'definition', index: map(pending.index) });
    }
    if (pending?.kind === 'example') {
      this.confirm.set({ ...pending, definitionIndex: map(pending.definitionIndex) });
    }
    const asking = this.askingExamples();
    if (asking != null) this.askingExamples.set(map(asking));
    const addingExample = this.addExampleFor();
    if (addingExample != null) this.addExampleFor.set(map(addingExample));
    const addingForm = this.addFormFor();
    if (addingForm != null) this.addFormFor.set(map(addingForm));
    const related = this.askingRelated();
    if (related != null) this.askingRelated.set(map(related));
    const wording = this.askingWording();
    if (wording != null) this.askingWording.set(map(wording));
    const forms = this.askingForms();
    if (forms != null) this.askingForms.set(map(forms));
    const engineer = this.exampleEngineer();
    if (engineer) {
      this.exampleEngineer.set({ ...engineer, definitionIndex: map(engineer.definitionIndex) });
    }
    const definitionEngineer = this.definitionEngineer();
    if (definitionEngineer) {
      this.definitionEngineer.set({
        ...definitionEngineer,
        definitionIndex: map(definitionEngineer.definitionIndex),
      });
    }
  }

  private shiftDefinitionIndexes(by: number): void {
    const editing = this.formEdit();
    if (editing) this.formEdit.set({ ...editing, definitionIndex: editing.definitionIndex + by });
    const editor = this.editor();
    if (editor?.kind === 'definition' && editor.index != null) {
      this.editor.set({ kind: 'definition', index: editor.index + by });
    }
    if (editor?.kind === 'example') {
      this.editor.set({ ...editor, definitionIndex: editor.definitionIndex + by });
    }
    const pending = this.confirm();
    if (pending?.kind === 'definition') {
      this.confirm.set({ kind: 'definition', index: pending.index + by });
    }
    if (pending?.kind === 'example') {
      this.confirm.set({ ...pending, definitionIndex: pending.definitionIndex + by });
    }
    const asking = this.askingExamples();
    if (asking != null) this.askingExamples.set(asking + by);
    const addingExample = this.addExampleFor();
    if (addingExample != null) this.addExampleFor.set(addingExample + by);
    const addingForm = this.addFormFor();
    if (addingForm != null) this.addFormFor.set(addingForm + by);
    const forms = this.askingForms();
    if (forms != null) this.askingForms.set(forms + by);
    const related = this.askingRelated();
    if (related != null) this.askingRelated.set(related + by);
    const wording = this.askingWording();
    if (wording != null) this.askingWording.set(wording + by);
    const engineer = this.exampleEngineer();
    if (engineer) {
      this.exampleEngineer.set({ ...engineer, definitionIndex: engineer.definitionIndex + by });
    }
    const definitionEngineer = this.definitionEngineer();
    if (definitionEngineer) {
      this.definitionEngineer.set({
        ...definitionEngineer,
        definitionIndex: definitionEngineer.definitionIndex + by,
      });
    }
  }

  async askForms(index: number): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    this.askingForms.set(index);
    this.error.set('');
    try {
      const forms = await generateForms({
        language: element.language,
        title: element.title,
        gloss,
        existingForms: definition.forms.map((form) => form.text),
      });
      if (!forms.length) {
        this.error.set('No further forms.');
        return;
      }
      const definitions = this.copyDefinitions();
      const target = definitions[index];
      if (!target) return;
      const seen = new Set(target.forms.map((form) => form.text.toLowerCase()));
      for (const form of forms) {
        const key = form.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        target.forms.push(form);
      }
      ensureRootLemma(target.forms, element.title);
      await this.persist(definitions, element.equivalents);
    } catch {
      this.error.set('Could not ask for forms.');
    } finally {
      this.askingForms.set(null);
    }
  }

  canHear(text: string): boolean {
    return canSpeak() && !!parsePassage(text).text.trim();
  }

  hear(key: string, text: string): void {
    const line = parsePassage(text).text.trim();
    if (!line) return;
    if (this.speaking() === key) {
      this.stopSpeech();
      return;
    }
    const started = speakText(line, this.element().language, () => {
      if (this.speaking() === key) this.speaking.set(null);
    });
    this.speaking.set(started ? key : null);
  }

  async copyText(key: string, text: string): Promise<void> {
    const value = parsePassage(text).text.trim();
    if (!value || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    this.clearCopied();
    this.copied.set(key);
    this.copiedTimer = setTimeout(() => {
      this.copied.set(null);
      this.copiedTimer = null;
    }, 1500);
  }

  askDeleteExample(definitionIndex: number, exampleIndex: number): void {
    if (this.aiBusy()) return;
    this.confirm.set({ kind: 'example', definitionIndex, exampleIndex });
  }

  askDeleteDefinition(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.confirm.set({ kind: 'definition', index });
  }

  async moveDefinition(index: number, delta: -1 | 1): Promise<void> {
    if (this.aiBusy()) return;
    const target = index + delta;
    const definitions = this.copyDefinitions();
    const current = definitions[index];
    if (!current || !definitions[target]) return;
    definitions.splice(index, 1);
    definitions.splice(target, 0, current);
    this.stopSpeech();
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    this.swapDefinitionIndexes(index, target);
  }

  openDefinition(index: number | null): void {
    const definition = index == null ? null : this.element().definitions[index];
    if (index != null && !definition) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.dismissTranslations();
    this.sheetMetadata.set({ ...(definition?.metadata ?? {}) });
    const equivalentId = definition?.equivalentId ?? null;
    const known =
      equivalentId && this.element().equivalents.some((item) => item.id === equivalentId)
        ? equivalentId
        : null;
    this.equivalentIdDraft.set(known);
    this.equivalentDraft.set('');
    this.frequencyDraft.set(normalizeDefinitionFrequency(definition?.frequency));
    this.beginSheet(definition?.text ?? '');
    this.editor.set({ kind: 'definition', index });
    this.focusDraft();
  }

  openExample(definitionIndex: number, exampleIndex: number | null): void {
    const definition = this.element().definitions[definitionIndex];
    if (!definition) return;
    const example = exampleIndex == null ? null : definition.examples[exampleIndex];
    if (exampleIndex != null && !example) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.dismissTranslations();
    this.sheetMetadata.set({ ...(example?.metadata ?? {}) });
    this.beginSheet(example?.text ?? '');
    this.editor.set({ kind: 'example', definitionIndex, exampleIndex });
    this.focusDraft();
  }

  exampleIndexesNewestFirst(count: number): number[] {
    const indexes: number[] = [];
    for (let index = count - 1; index >= 0; index -= 1) indexes.push(index);
    return indexes;
  }

  definitionForms(index: number): string[] {
    return this.element().definitions[index]?.forms.map((form) => form.text) ?? [];
  }

  openExampleEngineer(index: number): void {
    if (this.aiBusy()) return;
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) return;
    this.definitionEngineer.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.confirm.set(null);
    const draft = this.engineerDrafts.get(key) ?? { instruction: '', forms: [] };
    const available = new Set(definition.forms.map((form) => form.text.toLowerCase()));
    this.exampleEngineer.set({
      definitionIndex: index,
      instruction: draft.instruction,
      forms: draft.forms.filter((form) => available.has(form.toLowerCase())),
      formsOpen: false,
    });
  }

  closeExampleEngineer(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.askingExamples() !== null) return;
    this.exampleEngineer.set(null);
  }

  definitionEngineerBusy(index: number): boolean {
    return this.askingRelated() === index || this.askingWording() === index;
  }

  definitionSheetBusy(): boolean {
    return this.askingRelated() !== null || this.askingWording() !== null;
  }

  stagedWording(index: number): WordingSuggestion[] {
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!key) return [];
    return this.wordingSuggestions()[key] ?? [];
  }

  openDefinitionEngineer(index: number): void {
    if (this.aiBusy()) return;
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) return;
    const editor = this.editor();
    const editing = editor?.kind === 'definition' && editor.index === index;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.confirm.set(null);
    this.addDefinitionOpen.set(false);
    this.addExampleFor.set(null);
    this.addFormFor.set(null);
    this.exampleEngineer.set(null);
    this.dismissTranslations();
    const draft = this.definitionEngineerDrafts.get(key) ?? {
      instruction: '',
      words: [],
      selected: [],
    };
    const passage = parsePassage(editing ? this.textDraft() : definition.text);
    this.engineerGloss.set(passage.text);
    this.engineerEnglish.set(
      editing
        ? this.translationDraft()
        : (passage.translations.find((item) => item.language === 'en')?.text ?? ''),
    );
    const known = new Set(draft.words.map((word) => word.text.toLowerCase()));
    this.definitionEngineer.set({
      definitionIndex: index,
      instruction: draft.instruction,
      words: draft.words,
      selected: draft.selected.filter((text) => known.has(text.toLowerCase())),
    });
  }

  closeDefinitionEngineer(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.definitionSheetBusy()) return;
    this.definitionEngineer.set(null);
  }

  onDefinitionEngineerInstruction(event: Event): void {
    this.patchDefinitionEngineer({
      instruction: this.inputValue(event).slice(0, MAX_DEFINITION_INSTRUCTION),
    });
  }

  onEngineerGloss(event: Event): void {
    this.engineerGloss.set(this.inputValue(event));
  }

  onEngineerEnglish(event: Event): void {
    this.engineerEnglish.set(this.inputValue(event));
  }

  async saveEngineeredDefinition(): Promise<void> {
    if (this.aiBusy()) return;
    await this.commitEngineeredDefinition();
  }

  private async commitEngineeredDefinition(): Promise<boolean> {
    if (this.busy()) return false;
    const engineer = this.definitionEngineer();
    const gloss = this.engineerGloss().replace(/\s+/g, ' ').trim();
    if (!engineer || !gloss) return false;
    const element = this.element();
    const definitions = this.copyDefinitions();
    const target = definitions[engineer.definitionIndex];
    if (!target) return false;
    const oldSense = senseKey(target.text);
    const english = element.language === 'en' ? '' : this.engineerEnglish();
    const nextText = definitionFromDraft(target.text, gloss, english);
    if (nextText === target.text) return true;
    const nextSense = senseKey(nextText);
    target.text = nextText;
    if (!(await this.persist(definitions, element.equivalents))) return false;
    if (oldSense && nextSense && oldSense !== nextSense) {
      this.rekeyDefinitionEngineerDraft(oldSense, nextSense);
      this.rekeyExampleSuggestions(element.id, oldSense, nextSense);
      const staged = this.wordingSuggestions()[oldSense] ?? [];
      if (staged.length) this.rekeyWordingSuggestions(element.id, oldSense, nextSense, staged);
    }
    return true;
  }

  relatedWordChosen(word: RelatedWord): boolean {
    const key = word.text.toLowerCase();
    return this.definitionEngineer()?.selected.some((text) => text.toLowerCase() === key) ?? false;
  }

  toggleRelatedWord(word: RelatedWord): void {
    const engineer = this.definitionEngineer();
    if (!engineer || this.definitionSheetBusy()) return;
    const key = word.text.toLowerCase();
    const selected = engineer.selected.some((text) => text.toLowerCase() === key)
      ? engineer.selected.filter((text) => text.toLowerCase() !== key)
      : engineer.selected.length >= this.relatedPickMax
        ? engineer.selected
        : [...engineer.selected, word.text];
    this.patchDefinitionEngineer({ selected });
  }

  async findRelatedWords(): Promise<void> {
    const engineer = this.definitionEngineer();
    if (!engineer || this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[engineer.definitionIndex];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    const sense = senseKey(gloss);
    if (!definition || !sense) return;
    const job = ++this.relatedJob;
    const index = engineer.definitionIndex;
    this.askingRelated.set(index);
    this.error.set('');
    try {
      const words = await generateRelatedWords({
        language: element.language,
        title: element.title,
        gloss,
        metadata: definition.metadata,
        existingWords: engineer.words.map((word) => word.text),
        definitionInstruction: engineer.instruction,
      });
      const showing = this.element().id === element.id;
      const current = showing ? this.definitionEngineer() : null;
      const sameSense =
        showing && senseKey(this.element().definitions[index]?.text ?? '') === sense;
      if (!showing || !current || current.definitionIndex !== index || !sameSense) return;
      const seen = new Set(current.words.map((word) => word.text.toLowerCase()));
      const added = words.filter((word) => !seen.has(word.text.toLowerCase()));
      if (!added.length) {
        this.error.set('No further related words.');
        return;
      }
      this.patchDefinitionEngineer({ words: [...current.words, ...added] });
    } catch {
      if (this.element().id === element.id) this.error.set('Could not ask for related words.');
    } finally {
      if (this.relatedJob === job && this.element().id === element.id) this.askingRelated.set(null);
    }
  }

  async generateEngineeredDefinition(): Promise<void> {
    const engineer = this.definitionEngineer();
    const instruction = engineer?.instruction.trim() ?? '';
    if (!engineer || this.aiBusy() || (!instruction && !engineer.selected.length)) return;
    const element = this.element();
    const definition = element.definitions[engineer.definitionIndex];
    const gloss = this.engineerGloss().replace(/\s+/g, ' ').trim();
    const sense = senseKey(definition?.text ?? '');
    if (!definition) return;
    const picked = engineer.selected.flatMap((text) => {
      const word = engineer.words.find((item) => item.text.toLowerCase() === text.toLowerCase());
      return word ? [word] : [];
    });
    if (picked.length > this.relatedPickMax) return;
    const job = ++this.wordingJob;
    const index = engineer.definitionIndex;
    this.askingWording.set(index);
    this.error.set('');
    try {
      const phrases = await verbalizeDefinition({
        language: element.language,
        title: element.title,
        gloss,
        words: picked,
        definitionInstruction: engineer.instruction,
      });
      const phrase = phrases[0];
      const showing = this.element().id === element.id;
      if (!phrase) {
        if (showing) this.error.set('Could not forge a definition.');
        return;
      }
      const extra = parsePassage(phrase.text);
      if (!extra.text) {
        if (showing) this.error.set('Could not forge a definition.');
        return;
      }
      if (picked.some((word) => !sentenceUsesForm(extra.text, word.text))) {
        if (showing) this.error.set('The phrase did not use every chosen word.');
        return;
      }
      if (!showing) return;
      if (sense && senseKey(this.element().definitions[index]?.text ?? '') !== sense) return;
      this.engineerGloss.set(joinPhrase(this.engineerGloss(), extra.text));
      if (element.language !== 'en') {
        const english = extra.translations.find((item) => item.language === 'en')?.text ?? '';
        if (english) this.engineerEnglish.set(joinPhrase(this.engineerEnglish(), english));
      }
      await this.commitEngineeredDefinition();
    } catch {
      if (this.element().id === element.id) this.error.set('Could not forge a definition.');
    } finally {
      if (this.wordingJob === job && this.element().id === element.id) this.askingWording.set(null);
    }
  }

  dismissStagedWording(definitionIndex: number, stagedIndex: number): void {
    if (this.busy()) return;
    const definition = this.element().definitions[definitionIndex];
    const sense = senseKey(definition?.text ?? '');
    const list = sense ? (this.wordingSuggestions()[sense] ?? []) : [];
    if (!sense || !list[stagedIndex]) return;
    this.replaceWordingSuggestions(
      this.element().id,
      sense,
      list.filter((_, at) => at !== stagedIndex),
    );
  }

  async addStagedWording(definitionIndex: number, stagedIndex: number): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[definitionIndex];
    const sense = senseKey(definition?.text ?? '');
    const suggestion = sense ? this.wordingSuggestions()[sense]?.[stagedIndex] : undefined;
    if (!definition || !sense || !suggestion) return;
    const definitions = this.copyDefinitions();
    const target = definitions[definitionIndex];
    if (!target) return;
    const nextText = appendDefinitionPhrase(target.text, suggestion.text);
    if (nextText === target.text) return;
    const nextSense = senseKey(nextText);
    target.text = nextText;
    if (!(await this.persist(definitions, element.equivalents))) return;
    const list = this.wordingSuggestions()[sense] ?? [];
    const remaining = list.filter((item) => item !== suggestion);
    if (nextSense && nextSense !== sense) {
      this.rekeyWordingSuggestions(element.id, sense, nextSense, remaining);
      this.rekeyDefinitionEngineerDraft(sense, nextSense);
    } else {
      this.replaceWordingSuggestions(element.id, sense, remaining);
    }
  }

  toggleEngineerForms(): void {
    const engineer = this.exampleEngineer();
    if (!engineer || this.askingExamples() !== null) return;
    this.exampleEngineer.set({ ...engineer, formsOpen: !engineer.formsOpen });
  }

  onEngineerInstruction(event: Event): void {
    this.patchEngineer({
      instruction: this.inputValue(event).slice(0, MAX_EXAMPLE_INSTRUCTION),
    });
  }

  engineerFormChosen(form: string): boolean {
    const key = form.trim().toLowerCase();
    return this.exampleEngineer()?.forms.some((item) => item.toLowerCase() === key) ?? false;
  }

  toggleEngineerForm(form: string): void {
    const engineer = this.exampleEngineer();
    if (!engineer || this.askingExamples() !== null) return;
    const key = form.toLowerCase();
    const forms = engineer.forms.some((item) => item.toLowerCase() === key)
      ? engineer.forms.filter((item) => item.toLowerCase() !== key)
      : [...engineer.forms, form];
    this.patchEngineer({ forms });
  }

  async generateEngineeredExample(): Promise<void> {
    const engineer = this.exampleEngineer();
    if (!engineer || this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[engineer.definitionIndex];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    const sense = senseKey(gloss);
    if (!definition || !sense) return;
    const available = new Map(definition.forms.map((form) => [form.text.toLowerCase(), form.text]));
    const selected = engineer.forms.flatMap((form) => {
      const text = available.get(form.toLowerCase());
      return text ? [text] : [];
    });
    const required = selected.length ? selected[Math.floor(Math.random() * selected.length)] : '';
    const job = ++this.exampleJob;
    const index = engineer.definitionIndex;
    this.askingExamples.set(index);
    this.error.set('');
    try {
      const examples = await generateExamples({
        language: element.language,
        title: element.title,
        gloss,
        partOfSpeech: definition.metadata['part of speech'],
        existingExamples: definition.examples.map((example) => parsePassage(example.text).text),
        forms: required ? [] : definition.forms.map((form) => form.text),
        exampleWords: [],
        exampleInstruction: engineer.instruction,
        ...(required ? { requiredForm: required } : {}),
      });
      const sentence = examples[0];
      const showing = this.element().id === element.id;
      if (!sentence) {
        if (showing) this.error.set('No further examples.');
        return;
      }
      const primary = parsePassage(sentence.text).text;
      if (required && !sentenceUsesForm(primary, required)) {
        if (showing) this.error.set('The example did not use the chosen form.');
        return;
      }
      if (!showing) return;
      const definitions = this.copyDefinitions();
      const target = definitions.find((item) => senseKey(item.text) === sense);
      if (!target) return;
      const sentenceKey = senseKey(sentence.text);
      if (
        !sentenceKey ||
        target.examples.some((example) => senseKey(example.text) === sentenceKey)
      ) {
        this.error.set('No further examples.');
        return;
      }
      target.examples.push({ text: sentence.text, metadata: sentence.metadata });
      if (!(await this.persist(definitions, this.element().equivalents))) return;
      if (this.element().id === element.id) this.exampleEngineer.set(null);
    } catch {
      if (this.element().id === element.id) this.error.set('Could not ask for examples.');
    } finally {
      if (this.exampleJob === job && this.element().id === element.id)
        this.askingExamples.set(null);
    }
  }

  openExistingForm(definitionIndex: number, text: string): void {
    if (this.busy()) return;
    const form = this.element().definitions[definitionIndex]?.forms.find(
      (item) => item.text === text,
    );
    if (!form) return;
    this.openForm(definitionIndex, form);
  }

  closeFormSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.busy()) return;
    this.cancelForm();
  }

  openForm(
    definitionIndex: number,
    form?: { text: string; metadata: ElementMetadata },
  ): void {
    if (!this.element().definitions[definitionIndex]) return;
    this.addFormFor.set(null);
    this.addExampleFor.set(null);
    this.addDefinitionOpen.set(false);
    this.editor.set(null);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.confirm.set(null);
    this.metaEdit.set(null);
    this.dismissTranslations();
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formFeatures.set(form ? { ...form.metadata } : {});
    this.formDraft.set(form?.text ?? '');
    this.formEdit.set({ definitionIndex, originalText: form?.text ?? null });
    setTimeout(() => this.formField()?.nativeElement.focus());
  }

  onFormInput(event: Event): void {
    this.formError.set('');
    this.formDraft.set(this.inputValue(event));
  }

  cancelForm(): void {
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formEdit.set(null);
  }

  openFormFeature(previousKey: string | null): void {
    const metadata = this.formFeatures();
    this.formFeatureKey.set(previousKey ?? '');
    this.formFeatureValue.set(previousKey ? (metadata[previousKey] ?? '') : '');
    this.formFeatureEdit.set({ previousKey });
    setTimeout(() => this.formFeatureField()?.nativeElement.focus());
  }

  cancelFormFeature(): void {
    this.formFeatureEdit.set(null);
  }

  private formFeaturesToStore(): ElementMetadata {
    const editing = this.formFeatureEdit();
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value) return { ...this.formFeatures() };
    return writeMetadata(this.formFeatures(), editing.previousKey, key, value);
  }

  saveFormFeature(): void {
    const editing = this.formFeatureEdit();
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value || this.busy()) return;
    const current = this.formFeatures();
    if (editing.previousKey === key && current[key] === value) {
      this.cancelFormFeature();
      return;
    }
    this.formFeatures.set(writeMetadata(current, editing.previousKey, key, value));
    this.cancelFormFeature();
  }

  removeFormFeature(key: string): void {
    if (this.busy()) return;
    const next = { ...this.formFeatures() };
    delete next[key];
    this.formFeatures.set(next);
    if (this.formFeatureEdit()?.previousKey === key) this.cancelFormFeature();
  }

  openMetadata(previousKey: string | null): void {
    const metadata = this.sheetMetadata();
    this.metaKey.set(previousKey ?? '');
    this.metaValue.set(previousKey ? (metadata[previousKey] ?? '') : '');
    this.metaEdit.set({ previousKey });
    setTimeout(() => this.metaKeyField()?.nativeElement.focus());
  }

  cancelMetadata(): void {
    this.metaEdit.set(null);
  }

  highlightPassage(text: string): DefinitionHighlightPart[] {
    const element = this.element();
    const others: HighlightSource[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      others.push({
        id: item.id,
        title: item.title,
        forms: elementFormTexts(item),
        ...appearanceOf(item),
      });
    }
    return highlightDefinitionPassage(
      text,
      {
        id: element.id,
        title: element.title,
        forms: elementFormTexts(element),
        ...appearanceOf(element),
      },
      others,
    );
  }

  highlightColor(element: StoredElement): string {
    return resolveHighlightColor(element.highlightColor);
  }

  closeMode(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.busy()) return;
    this.modeOpen.set(false);
  }

  async chooseMode(mode: ElementMode): Promise<void> {
    if (this.busy()) return;
    if (this.element().mode !== mode && !(await this.saveAppearance({ mode }))) return;
    this.modeOpen.set(false);
  }

  openHighlight(): void {
    if (this.aiBusy()) return;
    const element = this.element();
    this.applyHighlightHex(resolveHighlightColor(element.highlightColor));
    this.styleDraft.set(resolveHighlightStyle(element.highlightStyle));
    this.colorOpen.set(true);
  }

  closeHighlight(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.busy()) return;
    this.colorOpen.set(false);
  }

  colorSvBackground(): string {
    return `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(this.colorHue(), 1, 1)})`;
  }

  canResetHighlight(): boolean {
    const element = this.element();
    return (
      element.highlightColor != null ||
      element.highlightStyle != null ||
      this.colorDraft() !== DEFAULT_HIGHLIGHT_COLOR ||
      this.styleDraft() !== 'solid'
    );
  }

  resetHighlight(): void {
    if (this.busy() || !this.canResetHighlight()) return;
    this.applyHighlightHex(DEFAULT_HIGHLIGHT_COLOR);
    this.styleDraft.set('solid');
  }

  highlightDirty(): boolean {
    const element = this.element();
    return (
      this.colorDraft() !== resolveHighlightColor(element.highlightColor) ||
      this.styleDraft() !== resolveHighlightStyle(element.highlightStyle)
    );
  }

  async saveHighlight(): Promise<void> {
    if (this.busy() || !this.highlightDirty()) return;
    const fallback = DEFAULT_HIGHLIGHT_COLOR;
    const color = this.colorDraft() === fallback ? null : sanitizeHighlightColor(this.colorDraft());
    const style = this.styleDraft() === 'solid' ? null : this.styleDraft();
    if (await this.saveAppearance({ highlightColor: color, highlightStyle: style })) {
      this.colorOpen.set(false);
    }
  }

  onHueInput(event: Event): void {
    if (this.busy()) return;
    this.colorHue.set(Number((event.target as HTMLInputElement).value));
    this.colorDraft.set(hsvToHex(this.colorHue(), this.colorSat(), this.colorVal()));
  }

  onColorPointer(event: PointerEvent): void {
    if (this.busy()) return;
    const map = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') map.setPointerCapture(event.pointerId);
    if (!map.hasPointerCapture(event.pointerId) && event.type !== 'pointerdown') return;
    event.preventDefault();
    const rect = map.getBoundingClientRect();
    this.colorSat.set(clamp01((event.clientX - rect.left) / (rect.width || 1)));
    this.colorVal.set(clamp01(1 - (event.clientY - rect.top) / (rect.height || 1)));
    this.colorDraft.set(hsvToHex(this.colorHue(), this.colorSat(), this.colorVal()));
  }

  private applyHighlightHex(hex: string): void {
    const color = sanitizeHighlightColor(hex) ?? DEFAULT_HIGHLIGHT_COLOR;
    const hsv = hexToHsv(color);
    this.colorDraft.set(color);
    this.colorHue.set(hsv.h);
    this.colorSat.set(hsv.s);
    this.colorVal.set(hsv.v);
  }

  private async saveAppearance(
    patch: Partial<Pick<StoredElement, 'highlightColor' | 'highlightStyle' | 'mode'>>,
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({ ...this.element(), ...patch });
      this.changed.emit(saved);
      return true;
    } catch {
      this.error.set('Could not save this element.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  showCollision(event: MouseEvent, matches: DefinitionHighlightMatch[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.collision.set(matches);
  }

  visitHighlight(id: string): void {
    this.collision.set(null);
    if (!id || id === this.element().id) return;
    this.visit.emit(id);
  }

  passagePick(definitionIndex: number, exampleIndex: number | null): PassageSelection | null {
    const pick = this.passageSelection();
    if (!pick || pick.definitionIndex !== definitionIndex || pick.exampleIndex !== exampleIndex) {
      return null;
    }
    return pick;
  }

  confirmPassagePick(event: Event, text: string, ai = false): void {
    event.preventDefault();
    event.stopPropagation();
    const title = text.replace(/\s+/g, ' ').trim();
    if (!title || this.aiBusy()) return;
    if (ai) this.addingSelection.set(true);
    this.blockPassageSelectionUntil = Date.now() + 400;
    window.getSelection()?.removeAllRanges();
    if (!ai) {
      this.passageSelection.set(null);
      this.addSelection.emit(title);
      return;
    }
    void this.askSelectionElement(title, this.passageSelection());
  }

  private async askSelectionElement(
    title: string,
    pick: PassageSelection | null,
  ): Promise<void> {
    const element = this.element();
    const definition = pick ? element.definitions[pick.definitionIndex] : undefined;
    const source =
      pick?.exampleIndex == null
        ? definition?.text
        : definition?.examples[pick.exampleIndex]?.text;
    const context = parsePassage(source ?? '').text;
    const example = pick?.exampleIndex == null ? '' : context;
    this.addingSelection.set(true);
    this.error.set('');
    try {
      const generated = await generateElementFromSelection({
        language: element.language,
        selected: title,
        context,
      });
      if (this.element().id !== element.id) return;
      if (!generated) {
        this.error.set('Could not add that element.');
        return;
      }
      this.passageSelection.set(null);
      this.addPrepared.emit({
        title: generated.lemma,
        example,
        definitions: generated.definitions.map((sense, index) => ({
          text: sense.text,
          equivalentId: null,
          forms: selectionForms(generated.lemma, title),
          examples: index === 0 && example ? [{ text: example, metadata: {} }] : [],
          metadata: { ...sense.metadata },
          frequency: sense.frequency,
        })),
      });
    } catch {
      if (this.element().id === element.id) this.error.set('Could not add that element.');
    } finally {
      if (this.element().id === element.id) this.addingSelection.set(false);
    }
  }

  private blockPassageSelectionUntil = 0;

  private readonly syncPassageSelection = (): void => {
    if (Date.now() < this.blockPassageSelectionUntil) {
      window.getSelection()?.removeAllRanges();
      if (!this.addingSelection()) this.passageSelection.set(null);
      return;
    }
    if (this.addingSelection()) return;
    this.passageSelection.set(readPassageSelection());
  };

  private readonly onSelectionPointerDown = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.sense-selectable, .lookup-chip')) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (!element?.closest('.sense-selectable')) return;
    selection.removeAllRanges();
    this.passageSelection.set(null);
  };

  showTranslationField(): boolean {
    return this.element().language !== 'en' || this.sheetTranslations().length > 0;
  }

  translationDraft(): string {
    return this.sheetTranslations().find((item) => item.language === 'en')?.text ?? '';
  }

  setTranslationDraft(value: string): void {
    const rest = this.sheetTranslations().filter((item) => item.language !== 'en');
    const text = value.replace(/]/g, '');
    this.sheetTranslations.set(text.trim() ? [...rest, { language: 'en', text }] : rest);
  }

  canTranslate(): boolean {
    const draft = this.textDraft().trim();
    return (
      this.element().language !== 'en' &&
      draft.length > 0 &&
      this.sheetTranslations().length === 0 &&
      parsePassage(draft).translations.length === 0 &&
      !this.translating() &&
      !this.askingEquivalent() &&
      !this.busy()
    );
  }

  async translateDraft(): Promise<void> {
    if (!this.canTranslate()) return;
    const text = this.textDraft().trim();
    const source = this.element().language;
    const ticket = this.translateTicket;
    this.translating.set(true);
    this.sheetError.set('');
    try {
      const translated = await translatePhrase(text, source);
      if (ticket !== this.translateTicket) return;
      this.sheetTranslations.set([{ language: 'en', text: translated }]);
    } catch {
      if (ticket !== this.translateTicket) return;
      this.sheetError.set('Could not translate this.');
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  async saveEditor(): Promise<void> {
    const editor = this.editor();
    const primary = this.textDraft().trim();
    if (!editor || !primary || this.busy() || this.translating() || this.askingEquivalent()) return;
    const text = this.phraseToStore();
    const definitions = this.copyDefinitions();
    if (editor.kind === 'definition') {
      const current = editor.index == null ? null : definitions[editor.index];
      if (editor.index != null && !current) return;
      const typed = this.equivalentDraft().trim();
      const selectedId = this.equivalentIdDraft();
      const linked = typed
        ? assignEquivalent(this.element().equivalents, typed)
        : {
            equivalents: this.element().equivalents,
            equivalentId:
              selectedId && this.element().equivalents.some((item) => item.id === selectedId)
                ? selectedId
                : null,
          };
      const next: ElementDefinition = {
        text,
        equivalentId: linked.equivalentId,
        forms: current?.forms ?? [],
        examples: current?.examples ?? [],
        metadata: this.metadataToStore(),
        frequency: this.frequencyDraft(),
      };
      if (editor.index == null) definitions.push(next);
      else definitions[editor.index] = next;
      if (await this.persist(definitions, linked.equivalents)) this.editor.set(null);
      return;
    }
    const definition = definitions[editor.definitionIndex];
    if (!definition) return;
    const current = editor.exampleIndex == null ? null : definition.examples[editor.exampleIndex];
    if (editor.exampleIndex != null && !current) return;
    const next = {
      text,
      metadata: this.metadataToStore(),
    };
    if (editor.exampleIndex == null) definition.examples.push(next);
    else definition.examples[editor.exampleIndex] = next;
    if (await this.persist(definitions, this.element().equivalents)) this.editor.set(null);
  }

  async saveForm(): Promise<void> {
    const editing = this.formEdit();
    const form = this.formDraft().trim().slice(0, FORM_MAX_LENGTH);
    if (!editing || !form || this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[editing.definitionIndex];
    if (!definition) return;
    if (!isValidForm(form)) {
      this.formError.set('That form is not valid.');
      return;
    }
    const original = editing.originalText;
    if (
      definition.forms.some(
        (item) => item.text !== original && item.text.toLowerCase() === form.toLowerCase(),
      )
    ) {
      this.formError.set('That form is already there.');
      return;
    }
    const next = { text: form, metadata: this.formFeaturesToStore() };
    if (original == null) definition.forms.push(next);
    else {
      const index = definition.forms.findIndex((item) => item.text === original);
      if (index < 0) return;
      definition.forms[index] = next;
    }
    ensureRootLemma(definition.forms, this.element().title);
    if (await this.persist(definitions, this.element().equivalents)) this.cancelForm();
  }

  private metadataToStore(): ElementMetadata {
    const editing = this.metaEdit();
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value) return { ...this.sheetMetadata() };
    return writeMetadata(this.sheetMetadata(), editing.previousKey, key, value);
  }

  saveMetadata(): void {
    const editing = this.metaEdit();
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value || this.busy()) return;
    const current = this.sheetMetadata();
    if (editing.previousKey === key && current[key] === value) {
      this.cancelMetadata();
      return;
    }
    this.sheetMetadata.set(writeMetadata(current, editing.previousKey, key, value));
    this.cancelMetadata();
  }

  removeMetadata(key: string): void {
    if (this.busy()) return;
    const next = { ...this.sheetMetadata() };
    delete next[key];
    this.sheetMetadata.set(next);
    if (this.metaEdit()?.previousKey === key) this.cancelMetadata();
  }

  async removeForm(definitionIndex: number, form: string): Promise<void> {
    if (this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[definitionIndex];
    if (!definition) return;
    definition.forms = definition.forms.filter((item) => item.text !== form);
    const editing = this.formEdit();
    if (editing?.definitionIndex === definitionIndex && editing.originalText === form) {
      this.formEdit.set(null);
    }
    await this.persist(definitions, this.element().equivalents);
  }

  confirmTitle(pending: ConfirmDelete): string {
    if (pending.kind === 'element') return 'Delete this element?';
    if (pending.kind === 'definition') return 'Delete this definition?';
    return 'Delete this example?';
  }

  askDeleteElement(): void {
    if (this.busy()) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.confirm.set({ kind: 'element' });
  }

  askDelete(): void {
    const editor = this.editor();
    if (editor?.kind !== 'example' || editor.exampleIndex == null) return;
    this.confirm.set({
      kind: 'example',
      definitionIndex: editor.definitionIndex,
      exampleIndex: editor.exampleIndex,
    });
  }

  async confirmDelete(): Promise<void> {
    const pending = this.confirm();
    if (!pending || this.busy()) return;
    if (pending.kind === 'element') {
      await this.removeElement();
      return;
    }
    const definitions = this.copyDefinitions();
    const removed =
      pending.kind === 'definition' ? senseKey(definitions[pending.index]?.text ?? '') : '';
    if (pending.kind === 'definition') definitions.splice(pending.index, 1); else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    if (pending.kind === 'definition') {
      if (removed && !definitions.some((definition) => senseKey(definition.text) === removed)) {
        this.engineerDrafts.delete(removed);
        this.definitionEngineerDrafts.delete(removed);
        writeRelatedDrafts(this.element().id, this.definitionEngineerDrafts);
        this.replaceExampleSuggestions(this.element().id, removed, []);
        this.replaceWordingSuggestions(this.element().id, removed, []);
      }
      const engineer = this.exampleEngineer();
      if (engineer?.definitionIndex === pending.index) this.exampleEngineer.set(null);
      else if (engineer && engineer.definitionIndex > pending.index) {
        this.exampleEngineer.set({
          ...engineer,
          definitionIndex: engineer.definitionIndex - 1,
        });
      }
      const definitionEngineer = this.definitionEngineer();
      if (definitionEngineer?.definitionIndex === pending.index) this.definitionEngineer.set(null);
      else if (definitionEngineer && definitionEngineer.definitionIndex > pending.index) {
        this.definitionEngineer.set({
          ...definitionEngineer,
          definitionIndex: definitionEngineer.definitionIndex - 1,
        });
      }
      const asking = this.askingExamples();
      if (asking === pending.index) this.askingExamples.set(null);
      else if (asking != null && asking > pending.index) this.askingExamples.set(asking - 1);
      const addingExample = this.addExampleFor();
      if (addingExample === pending.index) this.addExampleFor.set(null);
      else if (addingExample != null && addingExample > pending.index) {
        this.addExampleFor.set(addingExample - 1);
      }
      const addingForm = this.addFormFor();
      if (addingForm === pending.index) this.addFormFor.set(null);
      else if (addingForm != null && addingForm > pending.index) {
        this.addFormFor.set(addingForm - 1);
      }
      const forms = this.askingForms();
      if (forms === pending.index) this.askingForms.set(null);
      else if (forms != null && forms > pending.index) this.askingForms.set(forms - 1);
      const related = this.askingRelated();
      if (related === pending.index) this.askingRelated.set(null);
      else if (related != null && related > pending.index) this.askingRelated.set(related - 1);
      const wording = this.askingWording();
      if (wording === pending.index) this.askingWording.set(null);
      else if (wording != null && wording > pending.index) this.askingWording.set(wording - 1);
    }
    this.confirm.set(null);
    if (pending.kind === 'definition') this.editor.set(null);
    else this.adjustExampleEditor(pending.definitionIndex, pending.exampleIndex);
  }

  private clearCopied(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = null;
    this.copied.set(null);
  }

  private adjustExampleEditor(definitionIndex: number, exampleIndex: number): void {
    const editor = this.editor();
    if (editor?.kind !== 'example' || editor.definitionIndex !== definitionIndex) return;
    if (editor.exampleIndex === exampleIndex) this.editor.set(null);
    else if (editor.exampleIndex != null && editor.exampleIndex > exampleIndex) {
      this.editor.set({ ...editor, exampleIndex: editor.exampleIndex - 1 });
    }
  }

  private async removeElement(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.element().id;
      await deleteElement(id);
      writeDefinitionSuggestions(id, []);
      writeExampleSuggestions(id, {});
      writeWordingSuggestions(id, {});
      writeRelatedDrafts(id, new Map());
      this.confirm.set(null);
      this.deleted.emit();
    } catch {
      this.confirm.set(null);
      this.error.set('Could not delete this element.');
    } finally {
      this.busy.set(false);
    }
  }

  private patchEngineer(patch: Partial<EngineerDraft>): void {
    const engineer = this.exampleEngineer();
    if (!engineer) return;
    const next = { ...engineer, ...patch };
    this.exampleEngineer.set(next);
    const sense = senseKey(this.element().definitions[next.definitionIndex]?.text ?? '');
    if (!sense) return;
    this.engineerDrafts.set(sense, {
      instruction: next.instruction,
      forms: [...next.forms],
    });
  }

  private patchDefinitionEngineer(patch: Partial<DefinitionEngineerDraft>): void {
    const engineer = this.definitionEngineer();
    if (!engineer) return;
    const next = { ...engineer, ...patch };
    this.definitionEngineer.set(next);
    const sense = senseKey(this.element().definitions[next.definitionIndex]?.text ?? '');
    if (!sense) return;
    this.definitionEngineerDrafts.set(sense, {
      instruction: next.instruction,
      words: next.words.map((word) => ({ ...word })),
      selected: [...next.selected],
    });
    writeRelatedDrafts(this.element().id, this.definitionEngineerDrafts);
  }

  private rekeyDefinitionEngineerDraft(from: string, to: string): void {
    if (!from || !to || from === to) return;
    const draft = this.definitionEngineerDrafts.get(from);
    if (!draft) return;
    this.definitionEngineerDrafts.delete(from);
    this.definitionEngineerDrafts.set(to, draft);
    writeRelatedDrafts(this.element().id, this.definitionEngineerDrafts);
  }

  private loadWordingSuggestions(id: string): void {
    const stored = readWordingSuggestions(id);
    const senses = new Set(
      this.element()
        .definitions.map((definition) => senseKey(definition.text))
        .filter(Boolean),
    );
    const kept: Record<string, WordingSuggestion[]> = {};
    let dirty = false;
    for (const [sense, list] of Object.entries(stored)) {
      if (!senses.has(sense)) {
        dirty = true;
        continue;
      }
      if (list.length) kept[sense] = list;
    }
    if (Object.keys(kept).length !== Object.keys(stored).length) dirty = true;
    this.wordingSuggestions.set(kept);
    if (dirty) writeWordingSuggestions(id, kept);
  }

  private replaceWordingSuggestions(
    elementId: string,
    sense: string,
    list: WordingSuggestion[],
  ): void {
    const current =
      this.element().id === elementId
        ? { ...this.wordingSuggestions() }
        : readWordingSuggestions(elementId);
    if (list.length) current[sense] = list;
    else delete current[sense];
    writeWordingSuggestions(elementId, current);
    if (this.element().id === elementId) this.wordingSuggestions.set(current);
  }

  private rekeyExampleSuggestions(elementId: string, from: string, to: string): void {
    if (!from || !to || from === to) return;
    const current =
      this.element().id === elementId
        ? { ...this.exampleSuggestions() }
        : readExampleSuggestions(elementId);
    const moving = current[from];
    if (!moving?.length) return;
    delete current[from];
    current[to] = [...(current[to] ?? []), ...moving];
    writeExampleSuggestions(elementId, current);
    if (this.element().id === elementId) this.exampleSuggestions.set(current);
  }

  private rekeyWordingSuggestions(
    elementId: string,
    from: string,
    to: string,
    remaining: WordingSuggestion[],
  ): void {
    const current =
      this.element().id === elementId
        ? { ...this.wordingSuggestions() }
        : readWordingSuggestions(elementId);
    delete current[from];
    if (remaining.length && to) current[to] = [...(current[to] ?? []), ...remaining];
    writeWordingSuggestions(elementId, current);
    if (this.element().id === elementId) this.wordingSuggestions.set(current);
  }

  /** Examples generated before they were saved immediately. */
  private async commitStoredExamples(id: string): Promise<void> {
    const stored = readExampleSuggestions(id);
    if (this.element().id !== id) return;
    if (!Object.keys(stored).length) {
      this.exampleSuggestions.set({});
      return;
    }
    const definitions = this.copyDefinitions();
    let changed = false;
    for (const definition of definitions) {
      const sense = senseKey(definition.text);
      const list = sense ? stored[sense] : undefined;
      if (!list?.length) continue;
      const saved = new Set(
        definition.examples.map((example) => senseKey(example.text)).filter(Boolean),
      );
      for (const item of list) {
        const key = senseKey(item.text);
        if (!key || saved.has(key)) continue;
        definition.examples.push({ text: item.text, metadata: {} });
        saved.add(key);
        changed = true;
      }
    }
    if (!changed) {
      writeExampleSuggestions(id, {});
      this.exampleSuggestions.set({});
      return;
    }
    if (this.element().id !== id) return;
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    if (this.element().id !== id) return;
    writeExampleSuggestions(id, {});
    this.exampleSuggestions.set({});
  }

  private replaceExampleSuggestions(
    elementId: string,
    sense: string,
    list: ExampleSuggestion[],
  ): void {
    const current =
      this.element().id === elementId
        ? { ...this.exampleSuggestions() }
        : readExampleSuggestions(elementId);
    if (list.length) current[sense] = list;
    else delete current[sense];
    writeExampleSuggestions(elementId, current);
    if (this.element().id === elementId) this.exampleSuggestions.set(current);
  }

  private copyDefinitions(): ElementDefinition[] {
    return this.element().definitions.map((definition) => ({
      ...definition,
      forms: definition.forms.map((form) => ({ text: form.text, metadata: { ...form.metadata } })),
      examples: definition.examples.map((example) => ({
        ...example,
        metadata: { ...example.metadata },
      })),
      metadata: { ...definition.metadata },
    }));
  }

  private async persist(
    definitions: ElementDefinition[],
    equivalents: ElementEquivalent[],
  ): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({ ...this.element(), definitions, equivalents });
      this.changed.emit(saved);
      return true;
    } catch {
      this.error.set('Could not save this element.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private beginSheet(text: string): void {
    this.translateTicket += 1;
    this.equivalentTicket += 1;
    this.askingEquivalent.set(false);
    const passage = parsePassage(text);
    this.textDraft.set(passage.text);
    this.sheetTranslations.set(passage.translations);
    this.sheetError.set('');
    this.translating.set(false);
  }

  private phraseToStore(): string {
    return this.sheetTranslations().reduce(
      (raw, item) => embedTranslation(raw, item.language, item.text),
      this.textDraft().trim(),
    );
  }

  private focusDraft(): void {
    setTimeout(() => this.draftField()?.nativeElement.focus());
  }
}

function readPassageSelection(): PassageSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const anchor = node instanceof Element ? node : node.parentElement;
  const passage = anchor?.closest('.sense-selectable');
  if (!passage) return null;
  if (selectionCoversPassage(passage, range)) return null;
  const definitionIndex = Number(passage.getAttribute('data-definition-index'));
  if (!Number.isInteger(definitionIndex) || definitionIndex < 0) return null;
  const exampleRaw = passage.getAttribute('data-example-index');
  const exampleIndex = exampleRaw == null ? null : Number(exampleRaw);
  if (exampleIndex != null && (!Number.isInteger(exampleIndex) || exampleIndex < 0)) return null;
  return { text, definitionIndex, exampleIndex };
}

function selectionCoversPassage(passage: Element, range: Range): boolean {
  const covered = document.createRange();
  covered.selectNodeContents(passage);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, covered) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, covered) >= 0
  );
}

function appearanceOf(element: StoredElement): { color: string; style: HighlightStyle } {
  return {
    color: resolveHighlightColor(element.highlightColor),
    style: resolveHighlightStyle(element.highlightStyle),
  };
}

function elementFormTexts(element: StoredElement): string[] {
  return element.definitions.flatMap((definition) => formTexts(definition.forms));
}

function selectionForms(
  lemma: string,
  selected: string,
): Array<{ text: string; metadata: ElementMetadata }> {
  const forms: Array<{ text: string; metadata: ElementMetadata }> = [];
  const add = (value: string) => {
    const text = value.trim();
    if (!text || /[*()|]/.test(text) || !isValidForm(text)) return;
    if (forms.some((form) => form.text.toLowerCase() === text.toLowerCase())) return;
    forms.push({ text, metadata: {} });
  };
  add(lemma);
  add(selected);
  return forms;
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function retitleForms(
  forms: Array<{ text: string; metadata: ElementMetadata }>,
  previous: string,
  next: string,
): Array<{ text: string; metadata: ElementMetadata }> {
  const previousKey = previous.trim().toLowerCase();
  const nextName = next.trim();
  const nextValid = !!nextName && !/[*()|]/.test(nextName) && isValidForm(nextName);
  const updated = forms.flatMap((form) => {
    if (form.text.trim().toLowerCase() !== previousKey) return [form];
    if (!nextValid) return [];
    return [{ ...form, text: nextName }];
  });
  ensureRootLemma(updated, nextName);
  return updated;
}

function ensureRootLemma(forms: { text: string; metadata: ElementMetadata }[], title: string): void {
  const lemma = title.trim();
  if (!lemma || /[*()|]/.test(lemma) || !isValidForm(lemma)) return;
  const key = lemma.toLowerCase();
  if (forms.some((form) => form.text.toLowerCase() === key)) return;
  forms.unshift({ text: lemma, metadata: {} });
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const color = sanitizeHighlightColor(hex) ?? DEFAULT_HIGHLIGHT_COLOR;
  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta + 6) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = chroma;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = chroma;
  } else if (hue < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
