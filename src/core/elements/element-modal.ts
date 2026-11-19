import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  assignEquivalent,
  deleteElement,
  displayTitle,
  embedTranslation,
  equivalentTextFor,
  linkEquivalent,
  parsePassage,
  passageForEditing,
  pruneEquivalentLinks,
  type ParsedPassage,
  readEditingDraft,
  elementModeHelp,
  elementModeLabel,
  gameEarnedGem,
  type ElementMode,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  languageDisplayName,
  saveElement,
  sensesWithEquivalents,
  sanitizeElementColor,
  TRANSLATION_GEM_MAX,
  type DefinitionExampleLog,
  type DefinitionFormLog,
  type DefinitionGameLog,
  type DefinitionHighlightMatch,
  type DefinitionLogEntry,
  type DefinitionRevealLog,
  type DefinitionReworkLog,
  type DefinitionSnapshot,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementEquivalent,
  type RemovedDefinition,
  type ElementForm,
  type ElementMetadata,
  type StoredElement,
} from 'collection';
import {
  MAX_DEFINITION_INSTRUCTION,
  MAX_EXAMPLE_INSTRUCTION,
  MAX_EXAMPLE_LENGTH,
  MAX_RELATED_PICKS,
  generateDefinitionFromExample,
  generateElementFromSelection,
  type GeneratedDefinition,
  generateEquivalent,
  generateExamples,
  generateForms,
  generateRelatedWords,
  gradeDefinition,
  gradeEquivalent,
  gradeExample,
  polishDefinition,
  polishExample,
  suggestMetadata,
  type PolishDefinitionTask,
  sentenceUsesForm,
  translateTexts,
  verbalizeDefinition,
  type RelatedWord,
} from 'ai';
import {
  DEFINITION_MAX,
  EQUIVALENT_MAX,
  emptyPlayRound,
  insertRoundSlots,
  moveRoundSlot,
  removeRoundSlot,
  type EquivalentReward,
  type PlayRound,
} from './play-session';
import { Reveal } from './reveal';
import { RevealIcon } from './reveal-icon';
import { readFieldColor, type MetadataColorPlace } from './metadata-colors';
import { supportLanguageFor } from '../languages/translation-language';
import { HighlightColorPicker } from './highlight-color-picker';
import { GemIcon } from './gem-icon';
import { ModeIcon } from './mode-icon';
import { MissingDefinitionsModal } from './missing-definitions-modal';
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
  language: string;
  definitions: Array<ElementDefinition & { equivalent?: string }>;
  example: string;
  definition: number;
};

type HighlightSource = {
  id: string;
  title: string;
  forms: string[];
  color: string;
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

function mergeMetadata(current: ElementMetadata, extra: ElementMetadata): ElementMetadata {
  const taken = new Set(Object.keys(current).map((key) => key.toLowerCase()));
  const next = { ...current };
  for (const [key, value] of Object.entries(extra)) {
    const id = key.toLowerCase();
    if (!value || taken.has(id)) continue;
    taken.add(id);
    next[key] = value;
  }
  return next;
}

type DefinitionHistoryEntry =
  | DefinitionGameLog
  | DefinitionReworkLog
  | DefinitionExampleLog
  | DefinitionFormLog
  | DefinitionRevealLog
  | { event: 'view'; at: number };

type ExampleDraft = {
  definitionIndex: number;
  text: string;
  metadata: ElementMetadata;
};

type PendingForms = {
  definitionIndex: number;
  forms: ElementForm[];
};

type WorkTab = 'definitions' | 'examples' | 'forms';

type ConfirmDelete =
  | { kind: 'element' }
  | { kind: 'definition'; index: number }
  | { kind: 'definitions' }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number }
  | { kind: 'exercise'; definitionIndex: number; historyIndex: number };

const DELETE_PRESS_MS = 500;
type StoredSuggestion = {
  text: string;
  metadata: ElementMetadata;
  example?: string;
  equivalent?: string;
};

const SUGGESTIONS_KEY = 'lingogem.definition-suggestions.v1';
const NEW_DEFINITIONS_KEY = 'lingogem.definition-new.v1';

function definitionGloss(text: string): string {
  return parsePassage(text).text.trim().toLowerCase();
}

function readDefinitionSuggestions(elementId: string): StoredSuggestion[] {
  if (!elementId) return [];
  const stored = readRecord(SUGGESTIONS_KEY);
  return suggestionList(stored[elementId]);
}

function clearDefinitionSuggestions(elementId: string): void {
  if (!elementId) return;
  const stored = readRecord(SUGGESTIONS_KEY);
  if (!(elementId in stored)) return;
  delete stored[elementId];
  writeRecord(SUGGESTIONS_KEY, stored);
}

function readNewDefinitions(elementId: string): string[] {
  if (!elementId) return [];
  const value = readRecord(NEW_DEFINITIONS_KEY)[elementId];
  if (!Array.isArray(value)) return [];
  const glosses: string[] = [];
  for (const item of value) {
    const gloss = String(item ?? '')
      .trim()
      .toLowerCase();
    if (!gloss || glosses.includes(gloss)) continue;
    glosses.push(gloss);
  }
  return glosses;
}

function rememberNewDefinitions(elementId: string, glosses: readonly string[]): void {
  if (!elementId) return;
  const next = readNewDefinitions(elementId);
  for (const gloss of glosses) {
    const key = gloss.trim().toLowerCase();
    if (key && !next.includes(key)) next.push(key);
  }
  const stored = readRecord(NEW_DEFINITIONS_KEY);
  if (next.length) stored[elementId] = next;
  else delete stored[elementId];
  writeRecord(NEW_DEFINITIONS_KEY, stored);
}

function dismissNewDefinition(elementId: string, text: string): string[] {
  const gloss = definitionGloss(text);
  const stored = readRecord(NEW_DEFINITIONS_KEY);
  const next = readNewDefinitions(elementId).filter((item) => item !== gloss);
  if (next.length) stored[elementId] = next;
  else delete stored[elementId];
  writeRecord(NEW_DEFINITIONS_KEY, stored);
  return next;
}

function pruneNewDefinitions(elementId: string, present: ReadonlySet<string>): string[] {
  const next = readNewDefinitions(elementId).filter((gloss) => present.has(gloss));
  const stored = readRecord(NEW_DEFINITIONS_KEY);
  const current = readNewDefinitions(elementId);
  if (next.length !== current.length) {
    if (next.length) stored[elementId] = next;
    else delete stored[elementId];
    writeRecord(NEW_DEFINITIONS_KEY, stored);
  }
  return next;
}

function dropNewDefinitions(elementId: string): void {
  if (!elementId) return;
  const stored = readRecord(NEW_DEFINITIONS_KEY);
  if (!(elementId in stored)) return;
  delete stored[elementId];
  writeRecord(NEW_DEFINITIONS_KEY, stored);
}

function suggestionList(raw: unknown): StoredSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: StoredSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const example = String((item as { example?: unknown }).example ?? '')
      .trim()
      .slice(0, MAX_EXAMPLE_LENGTH);
    const equivalent = String((item as { equivalent?: unknown }).equivalent ?? '')
      .trim()
      .slice(0, EQUIVALENT_MAX);
    suggestions.push({
      text,
      metadata: suggestionMetadata((item as { metadata?: unknown }).metadata),
      ...(example ? { example } : {}),
      ...(equivalent ? { equivalent } : {}),
    });
  }
  return suggestions;
}

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

function readRecord(key: string): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeRecord(key: string, stored: Record<string, unknown>): void {
  if (typeof localStorage === 'undefined') return;
  if (Object.keys(stored).length) localStorage.setItem(key, JSON.stringify(stored));
  else localStorage.removeItem(key);
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
  imports: [
    NgTemplateOutlet,
    Reveal,
    RevealIcon,
    ModeIcon,
    GemIcon,
    HighlightColorPicker,
    CdkScrollable,
    MissingDefinitionsModal,
  ],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="dialogLabel()"
      (click)="onBackdrop($event)"
    >
      <div
        class="panel"
        [class.has-color]="!!element().color"
        [style.--swatch]="element().color || null"
        [attr.data-mode]="shownPlayMode()"
      >
        <ng-template #hearButton let-key="key" let-text="text" let-label="label" let-off="off">
          @if (canHear(text)) {
            <button
              type="button"
              class="icon-btn hear-inline"
              [class.active]="speaking() === key"
              [attr.aria-pressed]="speaking() === key"
              [attr.aria-label]="speaking() === key ? 'Stop speaking' : 'Hear ' + label"
              [attr.title]="speaking() === key ? 'Stop speaking' : 'Hear ' + label"
              [disabled]="!!off"
              (click)="hear(key, text); $event.stopPropagation()"
            >
              @if (speaking() === key) {
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
        </ng-template>
        <ng-template #lookupActions let-text="text">
          <div class="lookup-actions">
            <button
              type="button"
              class="lookup-chip"
              aria-label="Add element"
              [disabled]="aiBusy()"
              (pointerdown)="confirmPassagePick($event, text)"
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
              (pointerdown)="confirmPassagePick($event, text, true)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                />
              </svg>
              Ask AI
            </button>
          </div>
        </ng-template>
        <ng-template #translationIcon>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 8 6 6" />
            <path d="m4 14 6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" />
            <path d="M14 18h6" />
          </svg>
        </ng-template>
        <ng-template #formIcon>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
            />
            <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
            <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
          </svg>
        </ng-template>
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
            <div class="title-main">
              <h2>{{ shownTitle() }}</h2>
              <ng-container
                [ngTemplateOutlet]="hearButton"
                [ngTemplateOutletContext]="{
                  key: 'title',
                  text: shownTitle(),
                  label: 'title',
                }"
              />
              <button
                type="button"
                class="icon-btn color-btn"
                [class.has-color]="!!element().color"
                [style.--swatch]="element().color || null"
                aria-label="Edit element"
                title="Edit element"
                [disabled]="aiBusy()"
                (click)="openTitle()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  @if (element().color) {
                    <path class="nib" d="M2 22 7.5 20.5 19.6 8.4 15.6 4.4 3.5 16.5Z" />
                  }
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </button>
            </div>
            <div class="title-end">
              <button
                type="button"
                class="icon-btn danger"
                aria-label="Delete element"
                title="Delete element"
                [disabled]="busy()"
                (click)="askDeleteElement()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
              <button
                #closeButton
                type="button"
                class="close"
                aria-label="Close"
                (click)="closed.emit()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        <div #definitionBody class="body" cdkScrollable>
          @if (collision(); as matches) {
            <div class="collision" role="menu" aria-label="Matching elements">
              @for (match of matches; track match.elementId) {
                <button type="button" (click)="visitCollision(match.elementId)">
                  {{ shownTitle(match.title) }}
                </button>
              }
            </div>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          @if (element().definitions.length) {
            @let definitions = shownDefinitions();
            @let index = visibleDefinitionIndex();
            @if (definitions[index]; as definition) {
              <ol class="definitions">
                <li class="sense">
                  <div class="sense-toolbar">
                    <div class="sense-pager">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Previous definition"
                        [disabled]="index === 0"
                        (click)="showDefinition(index - 1)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m15 18-6-6 6-6" />
                        </svg>
                      </button>
                      <label class="definition-order">
                        <input
                          class="order-input"
                          type="text"
                          inputmode="numeric"
                          autocomplete="off"
                          [style.--digits]="orderDigits(definitions.length)"
                          [attr.aria-label]="
                            'Position ' + (index + 1) + ' of ' + definitions.length
                          "
                          [disabled]="definitions.length < 2"
                          [value]="index + 1"
                          (focus)="focusOrderInput($event)"
                          (input)="editOrderInput($event)"
                          (keydown.enter)="commitOrderInput($event, definitions.length)"
                          (keydown.escape)="cancelOrderInput($event)"
                          (blur)="commitOrderInput($event, definitions.length)"
                        />
                        <span class="order-total">/{{ definitions.length }}</span>
                      </label>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Next definition"
                        [disabled]="index >= definitions.length - 1"
                        (click)="showDefinition(index + 1)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Add a definition"
                        title="Add a definition"
                        [disabled]="aiBusy()"
                        (click)="addDefinitionManually()"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Missing definitions"
                        title="Missing definitions"
                        [disabled]="aiBusy()"
                        (click)="openMissingDefinitions()"
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
                    </div>
                    <div class="sense-actions">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Stats"
                        title="Stats"
                        [disabled]="definitionInPlay(index)"
                        (click)="openExerciseLog(index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
                          <path d="M18 17V9" />
                          <path d="M13 17V5" />
                          <path d="M8 17v-3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        [attr.aria-label]="definitionActionLabel(definition)"
                        [attr.title]="definitionActionLabel(definition)"
                        [disabled]="definitionInPlay(index) || aiBusy()"
                        (click)="openDefinition(index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn danger"
                        [attr.aria-label]="deleteLabel()"
                        [attr.title]="deleteTitle()"
                        [disabled]="definitionInPlay(index) || busy() || aiBusy()"
                        (pointerdown)="startDeletePress($event)"
                        (pointermove)="moveDeletePress($event)"
                        (pointerup)="endDeletePress()"
                        (pointercancel)="endDeletePress()"
                        (contextmenu)="$event.preventDefault()"
                        (click)="onDeleteClick()"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="sense-main">
                    <div class="sense-copy">
                      @let passage = parsePassage(definition.text);
                      <ng-container [ngTemplateOutlet]="definitionPassage" />
                      <ng-template #definitionPassage>
                        @if (passage.text) {
                          @if (definitionConcealed(index)) {
                            <div class="spoken">
                              <div class="spoken-copy">
                                <p class="passage definition-cue-text" aria-hidden="true">
                                  {{ shownDefinition(passage.text) }}
                                </p>
                                <ng-container [ngTemplateOutlet]="passageTranslations" />
                              </div>
                              <ng-container
                                [ngTemplateOutlet]="hearButton"
                                [ngTemplateOutletContext]="{
                                  key: 'definition:' + index,
                                  text: definition.text,
                                  label: 'definition',
                                  off: true,
                                }"
                              />
                            </div>
                          } @else {
                            <div class="spoken">
                              <div class="spoken-copy">
                                <p
                                  class="passage sense-selectable"
                                  [attr.data-definition-index]="index"
                                >
                                  @for (part of highlightPassage(passage.text); track $index) {
                                    @if (part.matches.length > 1) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [style.--score-color]="part.color || null"
                                        [textContent]="part.text"
                                        (click)="showCollision($event, part.matches, index)"
                                      ></button>
                                    } @else if (part.matches.length === 1 && !part.current) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [style.--score-color]="part.color || null"
                                        [textContent]="part.text"
                                        (click)="visitHighlight(part.matches[0].elementId, index)"
                                      ></button>
                                    } @else if (part.current) {
                                      <span
                                        class="linguagem-highlighted linguagem-highlighted--current"
                                        [style.--score-color]="part.color || null"
                                        [textContent]="part.text"
                                      ></span>
                                    } @else {
                                      <span [textContent]="part.text"></span>
                                    }
                                  }
                                </p>
                                <ng-container [ngTemplateOutlet]="passageTranslations" />
                              </div>
                              <ng-container
                                [ngTemplateOutlet]="hearButton"
                                [ngTemplateOutletContext]="{
                                  key: 'definition:' + index,
                                  text: definition.text,
                                  label: 'definition',
                                }"
                              />
                            </div>
                          }
                        }
                      </ng-template>
                      <ng-template #passageTranslations>
                        @let translations = shownTranslations(passage);
                        @if (translations.length) {
                          <ul class="equivalents">
                            @for (translation of translations; track $index) {
                              <li>
                                <app-reveal
                                  [text]="labeledTranslation(translation)"
                                  [locked]="definitionInPlay(index)"
                                  [open]="supportRevealed()"
                                  [scope]="index"
                                  (unveiled)="
                                    noteReveal(index, passage.text, translation.text, 'definition');
                                    unveilSupport(index)
                                  "
                                />
                              </li>
                            }
                          </ul>
                        }
                      </ng-template>
                      @let equivalent = equivalentText(definition);
                      @let meta = entries(definition.metadata);
                      @if ((supportAvailable() && equivalent) || meta.length) {
                        <ul class="sense-meta">
                          @if (supportAvailable() && equivalent) {
                            <li class="sense-equivalent">
                              @if (translationGame(index) && !equivalentSubmitted(index)) {
                                <span class="guess-answer play-blur" aria-hidden="true">{{
                                  labeledEquivalent(equivalent)
                                }}</span>
                              } @else if (translationGame(index)) {
                                <button
                                  type="button"
                                  class="guess-open"
                                  aria-label="See your equivalent"
                                  title="See your equivalent"
                                  (click)="openEquivalentPrompt(index)"
                                >
                                  <span class="guess-answer">{{
                                    labeledEquivalent(equivalent)
                                  }}</span>
                                </button>
                              } @else {
                                <ng-container [ngTemplateOutlet]="translationIcon" />
                                <app-reveal
                                  [text]="labeledEquivalent(equivalent)"
                                  [locked]="definitionInPlay(index)"
                                  [open]="equivalentUnveiled(equivalent)"
                                  [scope]="index"
                                  (unveiled)="unveilSupport(index)"
                                />
                              }
                            </li>
                          }
                          @for (entry of meta; track entry.key) {
                            @let color = metaColor('definitions', entry.key);
                            <li [class.colored]="color" [style.--meta-color]="color">
                              <span class="sense-meta-key">{{ label(entry.key) }}</span>
                              <span class="sense-meta-value">{{ label(entry.value) }}</span>
                            </li>
                          }
                        </ul>
                      }
                      @if (passagePick(index, null); as pick) {
                        <ng-container
                          [ngTemplateOutlet]="lookupActions"
                          [ngTemplateOutletContext]="{ text: pick.text }"
                        />
                      }
                      @if (playCue(index); as cue) {
                        <button
                          type="button"
                          class="btn btn-secondary play-cta"
                          (click)="openPlayCue(index)"
                        >
                          {{ cue.label }}
                          <span class="play-cta-count">{{ cue.left }} left</span>
                        </button>
                      }
                    </div>
                  </div>

                  @if (definition.examples.length) {
                    <section class="group">
                      <ul class="examples" aria-label="Examples">
                        @for (
                          exampleIndex of exampleIndexesNewestFirst(definition.examples.length);
                          track exampleIndex
                        ) {
                          @let example = definition.examples[exampleIndex];
                          <li class="saved-example">
                            <div
                              class="example-quote"
                              [class.play-blur]="exampleGame(index)"
                              [attr.aria-hidden]="exampleGame(index) ? true : null"
                            >
                              @let passage = parsePassage(example.text);
                              @if (passage.text) {
                                <div class="spoken">
                                  <div class="spoken-copy">
                                    <p
                                      class="passage sense-selectable"
                                      [attr.data-definition-index]="index"
                                      [attr.data-example-index]="exampleIndex"
                                    >
                                      @for (part of highlightPassage(passage.text); track $index) {
                                        @if (part.matches.length > 1) {
                                          <button
                                            type="button"
                                            class="linguagem-highlighted"
                                            [style.--score-color]="part.color || null"
                                            [textContent]="part.text"
                                            (click)="
                                              showCollision(
                                                $event,
                                                part.matches,
                                                index,
                                                example.text
                                              )
                                            "
                                          ></button>
                                        } @else if (part.matches.length === 1 && !part.current) {
                                          <button
                                            type="button"
                                            class="linguagem-highlighted"
                                            [style.--score-color]="part.color || null"
                                            [textContent]="part.text"
                                            (click)="
                                              visitHighlight(
                                                part.matches[0].elementId,
                                                index,
                                                example.text
                                              )
                                            "
                                          ></button>
                                        } @else if (part.current) {
                                          <span
                                            class="linguagem-highlighted linguagem-highlighted--current"
                                            [style.--score-color]="part.color || null"
                                            [textContent]="part.text"
                                          ></span>
                                        } @else {
                                          <span [textContent]="part.text"></span>
                                        }
                                      }
                                    </p>
                                    @let translations = shownTranslations(passage);
                                    @if (translations.length) {
                                      <ul class="equivalents">
                                        @for (translation of translations; track $index) {
                                          <li>
                                            <app-reveal
                                              [text]="labeledTranslation(translation)"
                                              [locked]="definitionInPlay(index)"
                                              [open]="supportRevealed()"
                                              [scope]="index"
                                              (unveiled)="
                                                noteReveal(
                                                  index,
                                                  passage.text,
                                                  translation.text,
                                                  'example'
                                                );
                                                unveilSupport(index)
                                              "
                                            />
                                          </li>
                                        }
                                      </ul>
                                    }
                                  </div>
                                  <ng-container
                                    [ngTemplateOutlet]="hearButton"
                                    [ngTemplateOutletContext]="{
                                      key: 'example:' + index + ':' + exampleIndex,
                                      text: example.text,
                                      label: 'example',
                                    }"
                                  />
                                </div>
                              }
                              @if (entries(example.metadata); as meta) {
                                @if (meta.length) {
                                  <ul class="pills">
                                    @for (entry of meta; track entry.key) {
                                      @let color = metaColor('examples', entry.key);
                                      <li [class.colored]="color" [style.--meta-color]="color">
                                        <span>
                                          <span class="sense-meta-key">{{ entry.key }}</span>
                                          <span class="sense-meta-value">{{ entry.value }}</span>
                                        </span>
                                      </li>
                                    }
                                  </ul>
                                }
                              }
                            </div>
                            @if (passagePick(index, exampleIndex); as pick) {
                              <ng-container
                                [ngTemplateOutlet]="lookupActions"
                                [ngTemplateOutletContext]="{ text: pick.text }"
                              />
                            }
                          </li>
                        }
                      </ul>
                    </section>
                  }
                  @if (definition.forms.length) {
                    <section class="group">
                      <ul class="forms" aria-label="Forms">
                        @for (form of definition.forms; track form.text) {
                          @let chip = formChipColor(form);
                          <li>
                            <button
                              type="button"
                              class="form-chip readonly"
                              [class.tinted]="!!chip"
                              [style.--form-color]="chip"
                              [attr.aria-label]="'Attributes for ' + form.text"
                              (click)="showFormAttributes(form)"
                            >
                              {{ form.text }}
                            </button>
                          </li>
                        }
                      </ul>
                    </section>
                  }
                </li>
              </ol>
            }
          } @else {
            <p class="empty">No definitions yet.</p>
          }
        </div>
        <footer class="definition-footer">
          <form class="example-slot" (submit)="submitDefinitionExample($event)">
            <div class="example-slot-field" [class.arrived]="!!heldExample()">
              @if (heldExample(); as held) {
                @let passage = parsePassage(held);
                <div class="example-slot-text">
                  @if (passage.text) {
                    <p>{{ passage.text }}</p>
                  }
                  @for (translation of shownTranslations(passage); track $index) {
                    <p class="example-slot-gloss">
                      <app-reveal [text]="labeledTranslation(translation)" [locked]="true" />
                    </p>
                  }
                </div>
              } @else {
                <input
                  type="text"
                  [value]="definitionExample()"
                  [attr.maxlength]="exampleLengthMax"
                  [disabled]="aiBusy()"
                  placeholder="Enter your own example…"
                  aria-label="Enter your own example"
                  aria-describedby="example-slot-hint"
                  (input)="definitionExample.set(inputValue($event))"
                />
              }
              <button
                type="submit"
                class="example-slot-submit"
                aria-label="Add example"
                [disabled]="aiBusy() || !definitionExample().trim()"
                [attr.aria-busy]="addingDefinitions() === 'example' ? true : null"
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
            </div>
            <p id="example-slot-hint" class="example-slot-hint">
              This sentence is matched to a definition that already fits, or a new definition is
              added.
            </p>
          </form>
        </footer>
        @if (editor(); as current) {
          <div class="sheet-backdrop" (click)="closeEditorSheet($event)">
            <section
              #editorSheet
              class="sheet editor-sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="
                current.kind === 'definition' ? workSectionLabel(current) : sheetTitle(current)
              "
            >
              @if (current.kind === 'example') {
                <div class="sheet-head">
                  <h3>{{ sheetTitle(current) }}</h3>
                  <span class="sheet-tools">
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Close"
                      (click)="closeEditor()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </span>
                </div>
              } @else {
                <div
                  class="lang work-tabs"
                  role="tablist"
                  [attr.aria-label]="workSectionLabel(current)"
                >
                  <button
                    type="button"
                    role="tab"
                    [class.on]="workTab() === 'definitions'"
                    [attr.aria-selected]="workTab() === 'definitions'"
                    (click)="showWorkTab('definitions')"
                  >
                    Definition
                  </button>
                  <button
                    type="button"
                    role="tab"
                    [class.on]="workTab() === 'examples'"
                    [attr.aria-selected]="workTab() === 'examples'"
                    [disabled]="current.index == null"
                    (click)="showWorkTab('examples')"
                  >
                    Examples
                  </button>
                  <button
                    type="button"
                    role="tab"
                    [class.on]="workTab() === 'forms'"
                    [attr.aria-selected]="workTab() === 'forms'"
                    [disabled]="current.index == null"
                    (click)="showWorkTab('forms')"
                  >
                    Forms
                  </button>
                </div>
              }
              <ng-template #editorFields>
                <div class="field-heading" [class.work-title]="current.kind === 'definition'">
                  <label
                    class="work-title-text"
                    [attr.for]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                  >
                    {{ current.kind === 'definition' ? 'Definition' : 'Example' }}
                  </label>
                  <span class="header-actions work-title-actions">
                    @if (supportAvailable()) {
                      <span class="generate-bundle translate-split">
                        <button
                          type="button"
                          class="generate-main"
                          [attr.aria-label]="translating() ? 'Translating…' : 'Translate'"
                          [attr.title]="translating() ? 'Translating…' : 'Translate'"
                          [attr.aria-busy]="translating() ? true : null"
                          [disabled]="!canTranslate()"
                          (click)="translateDraft()"
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
                      </span>
                    }
                    @if (current.kind === 'definition' && current.index != null) {
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Engineer definition"
                        title="Engineer definition"
                        [class.active]="definitionEngineerOpen()"
                        [attr.aria-pressed]="definitionEngineerOpen()"
                        [attr.aria-busy]="definitionEngineerBusy(current.index) ? true : null"
                        [disabled]="aiBusy() && !definitionEngineerOpen()"
                        (click)="toggleDefinitionEngineer()"
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
                  </span>
                </div>
                <div
                  class="definition-slot"
                  [class.engineering]="current.kind === 'definition' && !!definitionEngineer()"
                >
                  @if (current.kind === 'definition' && definitionEngineer(); as engineer) {
                    <div class="definition-ai">
                      <div class="instruct-field">
                        <input
                          id="definition-note"
                          [value]="engineer.instruction"
                          [attr.maxlength]="definitionInstructionMax"
                          [disabled]="definitionSheetBusy()"
                          placeholder="Instruct AI on how to modify this definition"
                          aria-label="Instruct AI on how to modify this definition"
                          (input)="onDefinitionEngineerInstruction($event)"
                          (keydown.enter)="$event.preventDefault(); generateEngineeredDefinition()"
                        />
                        <button
                          type="button"
                          class="entry-confirm"
                          aria-label="Modify definition"
                          [disabled]="
                            definitionSheetBusy() ||
                            (!engineer.instruction.trim() && !engineer.selected.length)
                          "
                          [attr.aria-busy]="askingWording() !== null ? true : null"
                          (click)="generateEngineeredDefinition()"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </button>
                      </div>
                      <div class="related-row">
                        <ul class="related-scroll">
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
                                <span class="relation">{{ label(word.relation) }}</span>
                                <span class="related-word">{{ word.text }}</span>
                              </button>
                            </li>
                          }
                          <li>
                            <button
                              type="button"
                              class="related-more"
                              aria-label="Find related"
                              title="Find related"
                              [disabled]="definitionSheetBusy()"
                              [attr.aria-busy]="askingRelated() !== null ? true : null"
                              (click)="findRelatedWords()"
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
                          </li>
                        </ul>
                      </div>
                    </div>
                  }
                  <textarea
                    #draftField
                    [id]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                    rows="3"
                    [value]="textDraft()"
                    (input)="textDraft.set(inputValue($event))"
                  ></textarea>
                </div>
                @if (sheetError()) {
                  <p class="error">{{ sheetError() }}</p>
                }
                @if (current.kind === 'definition' && supportAvailable()) {
                  <div class="equivalent-block">
                    <div class="field-heading">
                      <label class="field-label" for="definition-equivalent">Equivalent</label>
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
                    </div>
                    <ul class="equivalent-choices equivalent-pills">
                      @for (item of editorEquivalents(); track item.id) {
                        <li [class.selected]="equivalentSelected(item.id)">
                          <button
                            type="button"
                            [attr.aria-pressed]="equivalentSelected(item.id)"
                            [disabled]="busy()"
                            [attr.aria-label]="labeledEquivalent(item.text)"
                            (click)="chooseEquivalent(item.id)"
                          >
                            {{ labeledEquivalent(item.text) }}
                          </button>
                          <button
                            type="button"
                            class="tag-remove"
                            [disabled]="busy()"
                            [attr.aria-label]="'Remove equivalent ' + labeledEquivalent(item.text)"
                            (click)="removeEquivalent(item.id)"
                          >
                            ×
                          </button>
                        </li>
                      }
                      <li class="entry-pill">
                        <input
                          id="definition-equivalent"
                          class="equivalent-entry"
                          [value]="equivalentDraft()"
                          (input)="equivalentDraft.set(inputValue($event))"
                          [style.width]="equivalentEntryWidth()"
                          autocomplete="off"
                          placeholder="New equivalent"
                          aria-label="New equivalent"
                          (keydown.enter)="confirmEquivalent()"
                        />
                        <button
                          type="button"
                          class="entry-confirm"
                          aria-label="Add equivalent"
                          [disabled]="busy() || !equivalentDraft().trim()"
                          (click)="confirmEquivalent()"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </button>
                      </li>
                    </ul>
                  </div>
                }
                <div class="meta">
                  <div class="field-heading">
                    <span class="field-label">Metadata</span>
                    <button
                      type="button"
                      class="icon-btn"
                      [attr.aria-label]="
                        askingMetadata() ? 'Finding metadata…' : 'Ask AI for metadata'
                      "
                      [attr.title]="askingMetadata() ? 'Finding metadata…' : 'Ask AI for metadata'"
                      [attr.aria-busy]="askingMetadata() ? true : null"
                      [disabled]="!canAskMetadata()"
                      (click)="askMetadata()"
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
                  </div>
                  @if (metaEdit()) {
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
                        aria-label="Save metadata"
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
                  <ul class="pills">
                    @for (entry of entries(sheetMetadata()); track entry.key) {
                      @if (metaEdit()?.previousKey !== entry.key) {
                        @let color = sheetMetaColor(current.kind, entry.key);
                        <li [class.colored]="color" [style.--meta-color]="color">
                          <button
                            type="button"
                            [disabled]="busy()"
                            [attr.aria-label]="'Edit metadata ' + entry.key"
                            (click)="openMetadata(entry.key)"
                          >
                            <span class="sense-meta-key">{{ entry.key }}</span>
                            <span class="sense-meta-value">{{ entry.value }}</span>
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
                    @if (!metaEdit()) {
                      <li class="meta-entry">
                        <input
                          [value]="metaKey()"
                          [attr.maxlength]="metaKeyMaxLength"
                          [style.width]="metaEntryWidth(metaKey(), 'Key')"
                          placeholder="Key"
                          aria-label="Metadata key"
                          autocomplete="off"
                          (input)="metaKey.set(inputValue($event))"
                          (keydown.enter)="commitNewMetadata()"
                        />
                        <input
                          [value]="metaValue()"
                          [attr.maxlength]="metaValueMaxLength"
                          [style.width]="metaEntryWidth(metaValue(), 'Value')"
                          placeholder="Value"
                          aria-label="Metadata value"
                          autocomplete="off"
                          (input)="metaValue.set(inputValue($event))"
                          (keydown.enter)="commitNewMetadata()"
                        />
                        <button
                          type="button"
                          class="entry-confirm"
                          aria-label="Add metadata"
                          [disabled]="busy() || !metaKey().trim() || !metaValue().trim()"
                          (click)="commitNewMetadata()"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </button>
                      </li>
                    }
                  </ul>
                </div>
              </ng-template>
              <div class="sheet-scroll">
                @if (current.kind === 'definition') {
                  @if (workTab() === 'definitions' || current.index == null) {
                    <section class="sheet-part work-section">
                      <ng-container [ngTemplateOutlet]="editorFields" />
                    </section>
                  }
                  @if (current.index != null && workTab() === 'examples') {
                    @let workIndex = current.index;
                    @let worked = sheetDefinition(workIndex);
                    <section class="sheet-part work-section">
                      <div class="section-heading work-title">
                        <span class="section-title work-title-text">Examples</span>
                        <button
                          type="button"
                          class="icon-btn work-title-actions"
                          aria-label="Add an example"
                          title="Add an example"
                          [disabled]="aiBusy()"
                          (click)="addExampleManually(workIndex)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                      @if (worked && worked.examples.length) {
                        <ul class="examples">
                          @for (
                            exampleIndex of exampleIndexesNewestFirst(worked.examples.length);
                            track exampleIndex
                          ) {
                            @let example = worked.examples[exampleIndex];
                            <li class="saved-example">
                              <div class="example-quote">
                                @let passage = parsePassage(example.text);
                                @if (passage.text) {
                                  <div class="spoken">
                                    <div class="spoken-copy">
                                      <p
                                        class="passage sense-selectable"
                                        [attr.data-definition-index]="workIndex"
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
                                              [style.--score-color]="part.color || null"
                                              [textContent]="part.text"
                                              (click)="
                                                showCollision(
                                                  $event,
                                                  part.matches,
                                                  workIndex,
                                                  example.text
                                                )
                                              "
                                            ></button>
                                          } @else if (part.matches.length === 1 && !part.current) {
                                            <button
                                              type="button"
                                              class="linguagem-highlighted"
                                              [style.--score-color]="part.color || null"
                                              [textContent]="part.text"
                                              (click)="
                                                visitHighlight(
                                                  part.matches[0].elementId,
                                                  workIndex,
                                                  example.text
                                                )
                                              "
                                            ></button>
                                          } @else if (part.current) {
                                            <span
                                              class="linguagem-highlighted linguagem-highlighted--current"
                                              [style.--score-color]="part.color || null"
                                              [textContent]="part.text"
                                            ></span>
                                          } @else {
                                            <span [textContent]="part.text"></span>
                                          }
                                        }
                                      </p>
                                      @let translations = shownTranslations(passage);
                                      @if (translations.length) {
                                        <ul class="equivalents">
                                          @for (translation of translations; track $index) {
                                            <li>
                                              <app-reveal
                                                [text]="labeledTranslation(translation)"
                                                (unveiled)="
                                                  noteReveal(
                                                    workIndex,
                                                    passage.text,
                                                    translation.text,
                                                    'example'
                                                  )
                                                "
                                              />
                                            </li>
                                          }
                                        </ul>
                                      }
                                    </div>
                                    <ng-container
                                      [ngTemplateOutlet]="hearButton"
                                      [ngTemplateOutletContext]="{
                                        key: 'example:' + workIndex + ':' + exampleIndex,
                                        text: example.text,
                                        label: 'example',
                                      }"
                                    />
                                  </div>
                                }
                                @if (entries(example.metadata); as meta) {
                                  @if (meta.length) {
                                    <ul class="pills">
                                      @for (entry of meta; track entry.key) {
                                        @let color = metaColor('examples', entry.key);
                                        <li [class.colored]="color" [style.--meta-color]="color">
                                          <span>
                                            <span class="sense-meta-key">{{ entry.key }}</span>
                                            <span class="sense-meta-value">{{ entry.value }}</span>
                                          </span>
                                        </li>
                                      }
                                    </ul>
                                  }
                                }
                              </div>
                              <div class="item-actions">
                                <span class="item-actions-main">
                                    <button
                                      type="button"
                                      class="icon-btn"
                                      aria-label="Edit example"
                                      title="Edit example"
                                      [disabled]="aiBusy()"
                                      (click)="openExample(workIndex, exampleIndex)"
                                    >
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path
                                          d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      class="icon-btn danger"
                                      aria-label="Delete example"
                                      title="Delete example"
                                      [disabled]="aiBusy()"
                                      (click)="askDeleteExample(workIndex, exampleIndex)"
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
                              </div>
                              @if (passagePick(workIndex, exampleIndex); as pick) {
                                <ng-container
                                  [ngTemplateOutlet]="lookupActions"
                                  [ngTemplateOutletContext]="{ text: pick.text }"
                                />
                              }
                            </li>
                          }
                        </ul>
                      }
                      @if (exampleDraftFor(workIndex); as draft) {
                        <div class="example-quote">
                          @let passage = parsePassage(draft.text);
                          @if (passage.text) {
                            <p class="passage">{{ passage.text }}</p>
                            @let translations = shownTranslations(passage);
                            @if (translations.length) {
                              <ul class="equivalents">
                                @for (translation of translations; track $index) {
                                  <li>{{ labeledTranslation(translation) }}</li>
                                }
                              </ul>
                            }
                          }
                        </div>
                      }
                      @if (exampleEngineer(); as engineer) {
                        @if (engineer.definitionIndex === workIndex) {
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
                          @if (definitionForms(workIndex); as forms) {
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
                                  <svg
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                    [class.open]="engineer.formsOpen"
                                  >
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
                                          <ng-container [ngTemplateOutlet]="formIcon" />
                                          {{ form }}
                                        </button>
                                      </li>
                                    }
                                  </ul>
                                </div>
                              }
                            }
                          }
                          @if (exampleError()) {
                            <p class="error">{{ exampleError() }}</p>
                          }
                          <div class="sheet-actions example-actions">
                            <div class="generate-bundle">
                              <button
                                type="button"
                                class="generate-main"
                                [disabled]="askingExamples() !== null"
                                [attr.aria-busy]="askingExamples() !== null ? true : null"
                                (click)="generateEngineeredExample()"
                              >
                                Generate
                              </button>
                            </div>
                          </div>
                        }
                      }
                    </section>
                  }
                  @if (current.index != null && workTab() === 'forms') {
                    @let workIndex = current.index;
                    @let worked = sheetDefinition(workIndex);
                    <section class="sheet-part work-section">
                      <div class="section-heading work-title">
                        <span class="section-title work-title-text">Forms</span>
                        <div class="header-actions work-title-actions">
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Generate forms"
                            title="Generate forms"
                            [disabled]="aiBusy()"
                            [attr.aria-busy]="askingForms() === workIndex ? true : null"
                            (click)="generateForms(workIndex)"
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
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Add a form"
                            title="Add a form"
                            [disabled]="aiBusy()"
                            (click)="addFormManually(workIndex)"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M5 12h14" />
                              <path d="M12 5v14" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      @if (worked && worked.forms.length) {
                        <ul class="forms">
                          @for (form of worked.forms; track form.text) {
                            <li>
                              <div class="form-chip">
                                <button
                                  type="button"
                                  [disabled]="busy()"
                                  [attr.aria-label]="'Attributes for ' + form.text"
                                  (click)="showFormAttributes(form)"
                                >
                                  <ng-container [ngTemplateOutlet]="formIcon" />
                                  {{ form.text }}
                                </button>
                                <button
                                  type="button"
                                  class="form-edit"
                                  [disabled]="busy()"
                                  [attr.aria-label]="'Edit form ' + form.text"
                                  title="Edit form"
                                  (click)="openExistingForm(workIndex, form.text)"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  class="tag-remove"
                                  [disabled]="busy()"
                                  [attr.aria-label]="'Remove form ' + form.text"
                                  (click)="removeForm(workIndex, form.text)"
                                >
                                  ×
                                </button>
                              </div>
                            </li>
                          }
                        </ul>
                      }
                      @if (pendingFormsFor(workIndex); as pending) {
                        @if (pending.length) {
                          <p class="field-label">New forms</p>
                          <ul class="forms">
                            @for (form of pending; track form.text) {
                              <li>
                                <button
                                  type="button"
                                  class="form-chip readonly"
                                  [attr.aria-label]="'Attributes for ' + form.text"
                                  (click)="showFormAttributes(form)"
                                >
                                  <ng-container [ngTemplateOutlet]="formIcon" />
                                  {{ form.text }}
                                </button>
                              </li>
                            }
                          </ul>
                        }
                      }
                      @if (formsError()) {
                        <p class="error">{{ formsError() }}</p>
                      }
                    </section>
                  }
                } @else {
                  <ng-container [ngTemplateOutlet]="editorFields" />
                }
              </div>
              @if (current.kind === 'definition') {
                <div class="sheet-actions sheet-footer">
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="workSaveDisabled()"
                    (click)="saveWork()"
                  >
                    @if (workTab() === 'definitions' || current.index == null) {
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                        />
                      </svg>
                    }
                    Save
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="workCloseDisabled()"
                    (click)="closeEditor()"
                  >
                    Close
                  </button>
                </div>
              }
              @if (current.kind === 'example') {
                <div class="sheet-actions sheet-footer">
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="busy() || translating() || askingEquivalent() || !draftGloss()"
                    (click)="saveEditor()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                      />
                    </svg>
                    Save
                  </button>
                </div>
              }
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
                <div class="field-heading">
                  <span class="field-label">Metadata</span>
                  <button
                    type="button"
                    class="icon-btn"
                    [attr.aria-label]="
                      askingMetadata() ? 'Finding metadata…' : 'Ask AI for metadata'
                    "
                    [attr.title]="askingMetadata() ? 'Finding metadata…' : 'Ask AI for metadata'"
                    [attr.aria-busy]="askingMetadata() ? true : null"
                    [disabled]="!canAskFormMetadata()"
                    (click)="askFormMetadata()"
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
                </div>
                @if (formFeatureEdit()) {
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
                      aria-label="Save metadata"
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
                <ul class="pills">
                  @for (entry of entries(formFeatures()); track entry.key) {
                    @if (formFeatureEdit()?.previousKey !== entry.key) {
                      @let color = metaColor('forms', entry.key);
                      <li [class.colored]="color" [style.--meta-color]="color">
                        <button
                          type="button"
                          [disabled]="busy()"
                          [attr.aria-label]="'Edit metadata ' + entry.key"
                          (click)="openFormFeature(entry.key)"
                        >
                          <span class="sense-meta-key">{{ entry.key }}</span>
                          <span class="sense-meta-value">{{ entry.value }}</span>
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
                  @if (!formFeatureEdit()) {
                    <li class="meta-entry">
                      <input
                        [value]="formFeatureKey()"
                        [attr.maxlength]="metaKeyMaxLength"
                        [style.width]="metaEntryWidth(formFeatureKey(), 'Key')"
                        placeholder="Key"
                        aria-label="Metadata key"
                        autocomplete="off"
                        (input)="formFeatureKey.set(inputValue($event))"
                        (keydown.enter)="commitNewFormFeature()"
                      />
                      <input
                        [value]="formFeatureValue()"
                        [attr.maxlength]="metaValueMaxLength"
                        [style.width]="metaEntryWidth(formFeatureValue(), 'Value')"
                        placeholder="Value"
                        aria-label="Metadata value"
                        autocomplete="off"
                        (input)="formFeatureValue.set(inputValue($event))"
                        (keydown.enter)="commitNewFormFeature()"
                      />
                      <button
                        type="button"
                        class="entry-confirm"
                        aria-label="Add metadata"
                        [disabled]="
                          busy() || !formFeatureKey().trim() || !formFeatureValue().trim()
                        "
                        (click)="commitNewFormFeature()"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </button>
                    </li>
                  }
                </ul>
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

        @if (formAttributesView(); as form) {
          <div class="sheet-backdrop" (click)="closeFormAttributes($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="form.text + ' attributes'"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3 class="form-attributes-title">
                  <ng-container [ngTemplateOutlet]="formIcon" />
                  <span>{{ form.text }}</span>
                </h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="closeFormAttributes()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              @if (entries(form.metadata); as meta) {
                @if (meta.length) {
                  <ul class="pills" aria-label="Attributes">
                    @for (entry of meta; track entry.key) {
                      @let color = metaColor('forms', entry.key);
                      <li [class.colored]="color" [style.--meta-color]="color">
                        <span>
                          <span class="sense-meta-key">{{ label(entry.key) }}</span>
                          <span class="sense-meta-value">{{ label(entry.value) }}</span>
                        </span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="hint">No attributes</p>
                }
              }
            </section>
          </div>
        }

        @if (equivalentPromptOpen()) {
          @let prompt = equivalentPrompt();
          @if (element().definitions[prompt]; as definition) {
            @let answer = equivalentText(definition);
            @if (answer) {
              <div class="sheet-backdrop" (click)="closeEquivalentPrompt($event)">
                <section
                  class="sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Equivalent"
                  (click)="$event.stopPropagation()"
                >
                  <div class="sheet-head">
                    <h3>Equivalent</h3>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Close"
                      [disabled]="equivalentAwaitingScore(prompt)"
                      (click)="closeEquivalentPrompt()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                  @if (equivalentSubmitted(prompt)) {
                    @let passage = parsePassage(definition.text);
                    @let gloss = passage.text;
                    @let reward = equivalentRewardAt(prompt);
                    @let gaveUp = !equivalentDraftAt(prompt).trim();
                    @if (gloss && !gaveUp) {
                      <div class="equivalent-gloss">
                        <p class="field-label">Definition</p>
                        <p>{{ shownDefinition(gloss) }}</p>
                        @let translations = shownTranslations(passage);
                        @if (translations.length) {
                          <ul class="equivalents">
                            @for (translation of translations; track $index) {
                              <li>
                                <app-reveal
                                  [text]="labeledTranslation(translation)"
                                  (unveiled)="
                                    noteReveal(prompt, passage.text, translation.text, 'definition')
                                  "
                                />
                              </li>
                            }
                          </ul>
                        }
                      </div>
                    }
                    @if (gaveUp) {
                      <p class="field-label">You gave up</p>
                      <p class="equivalent-result">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 8 6 6" />
                          <path d="m4 14 6-6 2-3" />
                          <path d="M2 5h12" />
                          <path d="M7 2h1" />
                          <path d="m22 22-5-10-5 10" />
                          <path d="M14 18h6" />
                        </svg>
                        <span>{{ labeledEquivalent(answer) }}</span>
                      </p>
                      <div class="sheet-actions">
                        <button
                          type="button"
                          class="btn btn-primary"
                          [disabled]="busy()"
                          (click)="closeEquivalentPrompt()"
                        >
                          Done
                        </button>
                      </div>
                    } @else {
                      <div class="compare">
                        <div class="compare-side">
                          <p class="field-label">Equivalent</p>
                          <p class="equivalent-result">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m5 8 6 6" />
                              <path d="m4 14 6-6 2-3" />
                              <path d="M2 5h12" />
                              <path d="M7 2h1" />
                              <path d="m22 22-5-10-5 10" />
                              <path d="M14 18h6" />
                            </svg>
                            <span>{{ labeledEquivalent(answer) }}</span>
                          </p>
                        </div>
                        <div class="compare-side yours">
                          <p class="field-label">You wrote</p>
                          <p>{{ equivalentDraftAt(prompt) }}</p>
                        </div>
                      </div>
                      <p class="field-label">Score</p>
                      <div
                        class="score-pick"
                        data-game="translation"
                        role="group"
                        aria-label="Score"
                      >
                        @for (score of scores; track score) {
                          <button
                            type="button"
                            class="score-pick-value"
                            [class.on]="reward?.score === score"
                            [attr.aria-pressed]="reward?.score === score"
                            [attr.aria-label]="'Score ' + score"
                            [disabled]="aiBusy()"
                            (click)="awardEquivalent(prompt, score)"
                          >
                            {{ score }}
                          </button>
                        }
                        <button
                          type="button"
                          class="btn btn-secondary"
                          [disabled]="aiBusy() || reward?.by === 'ai'"
                          [attr.aria-busy]="askingEquivalentGrade() === prompt ? true : null"
                          (click)="judgeEquivalent(prompt)"
                        >
                          {{ askingEquivalentGrade() === prompt ? 'Asking…' : 'Ask AI' }}
                        </button>
                      </div>
                      @if (reward; as scored) {
                        @if (scored.by === 'ai' && scored.explanation) {
                          <p>{{ scored.explanation }}</p>
                        }
                      }
                      @if (equivalentGradeError()) {
                        <p class="error">{{ equivalentGradeError() }}</p>
                      }
                      <div class="sheet-actions">
                        <button
                          type="button"
                          class="btn btn-primary"
                          [disabled]="equivalentAwaitingScore(prompt) || busy()"
                          (click)="closeEquivalentPrompt()"
                        >
                          Done
                        </button>
                      </div>
                    }
                  } @else {
                    <p class="equivalent-prompt">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m5 8 6 6" />
                        <path d="m4 14 6-6 2-3" />
                        <path d="M2 5h12" />
                        <path d="M7 2h1" />
                        <path d="m22 22-5-10-5 10" />
                        <path d="M14 18h6" />
                      </svg>
                      <span class="play-blur" aria-hidden="true">{{
                        labeledEquivalent(answer)
                      }}</span>
                    </p>
                    <label class="field-label" [attr.for]="'play-equivalent-' + prompt">
                      Write the equivalent
                    </label>
                    <input
                      #equivalentField
                      [id]="'play-equivalent-' + prompt"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      [value]="equivalentDraftAt(prompt)"
                      [attr.maxlength]="equivalentMax"
                      placeholder="Write the equivalent"
                      (input)="onEquivalentDraft(prompt, $event)"
                      (keydown.enter)="submitEquivalent(prompt, $event)"
                    />
                    @if (equivalentGradeError()) {
                      <p class="error">{{ equivalentGradeError() }}</p>
                    }
                    <div class="sheet-actions">
                      <button
                        type="button"
                        class="btn btn-primary"
                        [disabled]="busy() || !equivalentDraftAt(prompt).trim()"
                        (click)="submitEquivalent(prompt)"
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        class="btn btn-secondary"
                        [disabled]="busy()"
                        (click)="giveUpEquivalent(prompt)"
                      >
                        Give up
                      </button>
                      <button
                        type="button"
                        class="btn btn-secondary"
                        (click)="equivalentPrompt.set(-1)"
                      >
                        Cancel
                      </button>
                    </div>
                  }
                </section>
              </div>
            }
          }
        }

        @if (definitionPromptOpen()) {
          @let prompt = definitionPrompt();
          @if (element().definitions[prompt]; as definition) {
            <div class="sheet-backdrop" (click)="closeDefinitionPrompt($event)">
              <section class="sheet" role="dialog" aria-modal="true" aria-label="Definition">
                <div class="sheet-head">
                  <h3>Definition</h3>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Close"
                    [disabled]="askingGrade() === prompt || definitionAwaitingScore(prompt)"
                    (click)="closeDefinitionPrompt()"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
                @if (definitionSubmitted(prompt)) {
                  @if (!definitionDraftAt(prompt).trim()) {
                    <p class="field-label">You gave up</p>
                    @let gloss = parsePassage(definition.text);
                    <p class="passage">{{ shownDefinition(gloss.text) }}</p>
                    @let translations = shownTranslations(gloss);
                    @if (translations.length) {
                      <ul class="equivalents">
                        @for (translation of translations; track $index) {
                          <li>
                            <app-reveal
                              [text]="labeledTranslation(translation)"
                              (unveiled)="
                                noteReveal(prompt, gloss.text, translation.text, 'definition')
                              "
                            />
                          </li>
                        }
                      </ul>
                    }
                    <div class="sheet-actions">
                      <button
                        type="button"
                        class="btn btn-primary"
                        (click)="definitionPrompt.set(-1)"
                      >
                        Done
                      </button>
                    </div>
                  } @else {
                    @let reward = definitionRewardAt(prompt);
                    <div class="compare">
                      <div class="compare-side">
                        <p class="field-label">Definition</p>
                        @let gloss = parsePassage(definition.text);
                        <p class="passage">{{ shownDefinition(gloss.text) }}</p>
                        @let translations = shownTranslations(gloss);
                        @if (translations.length) {
                          <ul class="equivalents">
                            @for (translation of translations; track $index) {
                              <li>
                                <app-reveal
                                  [text]="labeledTranslation(translation)"
                                  (unveiled)="
                                    noteReveal(prompt, gloss.text, translation.text, 'definition')
                                  "
                                />
                              </li>
                            }
                          </ul>
                        }
                      </div>
                      <div class="compare-side yours">
                        <p class="field-label">Your answer</p>
                        <p>{{ definitionDraftAt(prompt) }}</p>
                      </div>
                    </div>
                    <p class="field-label">Score</p>
                    <div class="score-pick" data-game="definition" role="group" aria-label="Score">
                      @for (score of scores; track score) {
                        <button
                          type="button"
                          class="score-pick-value"
                          [class.on]="reward?.score === score"
                          [attr.aria-pressed]="reward?.score === score"
                          [attr.aria-label]="'Score ' + score"
                          [disabled]="aiBusy()"
                          (click)="awardDefinition(prompt, score)"
                        >
                          {{ score }}
                        </button>
                      }
                      <button
                        type="button"
                        class="btn btn-secondary"
                        [disabled]="aiBusy() || reward?.by === 'ai'"
                        [attr.aria-busy]="askingGrade() === prompt ? true : null"
                        (click)="evaluateDefinition(prompt)"
                      >
                        {{ askingGrade() === prompt ? 'Asking…' : 'Ask AI' }}
                      </button>
                    </div>
                    @if (reward; as scored) {
                      @if (scored.by === 'ai' && scored.explanation) {
                        <p>{{ scored.explanation }}</p>
                      }
                    }
                    @if (error()) {
                      <p class="error">{{ error() }}</p>
                    }
                    <div class="sheet-actions">
                      <button
                        type="button"
                        class="btn btn-primary"
                        [disabled]="definitionAwaitingScore(prompt) || askingGrade() === prompt"
                        (click)="closeDefinitionPrompt()"
                      >
                        Done
                      </button>
                    </div>
                  }
                } @else {
                  <div class="field-heading">
                    @if (supportAvailable()) {
                      <div class="lang" role="tablist" aria-label="Definition language">
                        <button
                          type="button"
                          role="tab"
                          [class.on]="definitionSource() === 'support'"
                          [attr.aria-selected]="definitionSource() === 'support'"
                          [disabled]="translating() || askingPolish() !== null"
                          (click)="workDefinition('support')"
                        >
                          {{ translationLanguageName() }}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          [class.on]="definitionSource() === 'working'"
                          [attr.aria-selected]="definitionSource() === 'working'"
                          [disabled]="translating() || askingPolish() !== null"
                          (click)="workDefinition('working')"
                        >
                          {{ originalLanguageName() }}
                        </button>
                      </div>
                    } @else {
                      <label class="field-label" [attr.for]="'play-definition-' + prompt">
                        Definition
                      </label>
                    }
                    <span class="header-actions">
                      @if (supportAvailable()) {
                        <span class="generate-bundle translate-split">
                          <button
                            type="button"
                            class="generate-main"
                            [attr.aria-label]="translating() ? 'Translating…' : 'Translate'"
                            [attr.title]="translating() ? 'Translating…' : 'Translate'"
                            [attr.aria-busy]="translating() ? true : null"
                            [disabled]="!canTranslateDefinition(prompt)"
                            (click)="translateDefinition(prompt)"
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
                        </span>
                      }
                      @if (!supportAvailable() || definitionSource() === 'working') {
                        <button
                          type="button"
                          class="icon-btn fix"
                          aria-label="Correct"
                          title="Correct"
                          [attr.aria-busy]="askingPolish() === 'correct' ? true : null"
                          [disabled]="!canPolishDefinition(prompt)"
                          (click)="polishWorkingDefinition(prompt, 'correct')"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m6 16 6-12 6 12" />
                            <path d="M8 12h8" />
                            <path d="m16 20 2 2 4-4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn idea"
                          aria-label="Reformulate"
                          title="Reformulate"
                          [attr.aria-busy]="askingPolish() === 'reformulate' ? true : null"
                          [disabled]="!canPolishDefinition(prompt)"
                          (click)="polishWorkingDefinition(prompt, 'reformulate')"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 20h9" />
                            <path
                              d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"
                            />
                          </svg>
                        </button>
                      }
                    </span>
                  </div>
                  @if (supportAvailable() && definitionSource() === 'support') {
                    <textarea
                      #supportField
                      [id]="'play-definition-support-' + prompt"
                      rows="2"
                      [attr.aria-label]="translationLanguageName()"
                      [value]="definitionSupportDraftAt(prompt)"
                      [attr.maxlength]="definitionMax"
                      [disabled]="askingGrade() === prompt || translating()"
                      placeholder="Write the definition"
                      (input)="onDefinitionSupportDraft(prompt, $event)"
                    ></textarea>
                  } @else {
                    @if (definitionPolishNote(); as note) {
                      <div
                        class="compare-side"
                        [class.fix]="note.task === 'correct'"
                        [class.idea]="note.task === 'reformulate'"
                      >
                        <div class="field-heading">
                          <p class="field-label">
                            {{ note.task === 'correct' ? 'Correction' : 'Reformulation' }}
                          </p>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Dismiss"
                            (click)="definitionPolishNote.set(null)"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                        @if (note.task === 'correct') {
                          <p class="hint">{{ note.explanation }}</p>
                        } @else {
                          <div class="add-choices">
                            @for (option of note.options; track $index) {
                              <button
                                type="button"
                                class="btn btn-secondary add-choice"
                                (click)="useDefinitionProposition(prompt, option)"
                              >
                                {{ option }}
                              </button>
                            }
                          </div>
                        }
                      </div>
                    }
                    <textarea
                      #definitionField
                      [id]="'play-definition-' + prompt"
                      rows="2"
                      [value]="definitionDraftAt(prompt)"
                      [attr.maxlength]="definitionMax"
                      [disabled]="
                        askingGrade() === prompt || translating() || askingPolish() !== null
                      "
                      [attr.aria-label]="supportAvailable() ? originalLanguageName() : 'Definition'"
                      placeholder="Write the definition"
                      (input)="onDefinitionDraft(prompt, $event)"
                    ></textarea>
                  }
                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                  <div class="sheet-actions">
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="aiBusy() || translating() || !definitionDraftAt(prompt).trim()"
                      (click)="submitDefinition(prompt)"
                    >
                      Submit
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="askingGrade() === prompt"
                      (click)="giveUpDefinition(prompt)"
                    >
                      Give up
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="askingGrade() === prompt"
                      (click)="definitionPrompt.set(-1)"
                    >
                      Cancel
                    </button>
                  </div>
                }
              </section>
            </div>
          }
        }

        @if (examplePromptOpen()) {
          @let prompt = examplePrompt();
          @if (element().definitions[prompt]; as definition) {
            <div class="sheet-backdrop" (click)="closeExamplePrompt($event)">
              <section class="sheet" role="dialog" aria-modal="true" aria-label="Example">
                <div class="sheet-head">
                  <h3>Example</h3>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Close"
                    [disabled]="askingExampleGrade() === prompt || exampleAwaitingScore(prompt)"
                    (click)="closeExamplePrompt()"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
                @let gloss = parsePassage(definition.text);
                @if (gloss.text) {
                  <div class="equivalent-gloss">
                    <p class="field-label">Definition</p>
                    <p>{{ shownDefinition(gloss.text) }}</p>
                    @let translations = shownTranslations(gloss);
                    @if (translations.length) {
                      <ul class="equivalents">
                        @for (translation of translations; track $index) {
                          <li>
                            <app-reveal
                              [text]="labeledTranslation(translation)"
                              [locked]="!exampleSubmitted(prompt)"
                              (unveiled)="
                                noteReveal(prompt, gloss.text, translation.text, 'definition')
                              "
                            />
                          </li>
                        }
                      </ul>
                    }
                  </div>
                }
                @if (exampleSubmitted(prompt)) {
                  @if (!exampleDraftAt(prompt).trim()) {
                    <p class="field-label">You gave up</p>
                    <div class="sheet-actions">
                      <button type="button" class="btn btn-primary" (click)="examplePrompt.set(-1)">
                        Done
                      </button>
                    </div>
                  } @else {
                    <div class="compare-side yours">
                      <p class="field-label">Your example</p>
                      <p>{{ exampleDraftAt(prompt) }}</p>
                    </div>
                    <p class="field-label">Score</p>
                    @if (askingExampleGrade() === prompt) {
                      <p class="hint">Asking…</p>
                    } @else if (exampleRewardAt(prompt); as reward) {
                      <p
                        class="score-readout"
                        data-game="example"
                        role="img"
                        [attr.aria-label]="'Score ' + reward.score + ' out of 5'"
                      >
                        {{ reward.score }}<span class="score-max">/5</span>
                      </p>
                      @if (reward.explanation) {
                        <p>{{ reward.explanation }}</p>
                      }
                    }
                    @if (error()) {
                      <p class="error">{{ error() }}</p>
                    }
                    <div class="sheet-actions">
                      @if (exampleAwaitingScore(prompt) && askingExampleGrade() !== prompt) {
                        <button
                          type="button"
                          class="btn btn-secondary"
                          [disabled]="aiBusy()"
                          (click)="evaluateExample(prompt)"
                        >
                          Try again
                        </button>
                      }
                      <button
                        type="button"
                        class="btn btn-primary"
                        [disabled]="exampleAwaitingScore(prompt) || askingExampleGrade() === prompt"
                        (click)="closeExamplePrompt()"
                      >
                        Done
                      </button>
                    </div>
                  }
                } @else {
                  <div class="field-heading">
                    @if (supportAvailable()) {
                      <div class="lang" role="tablist" aria-label="Example language">
                        <button
                          type="button"
                          role="tab"
                          [class.on]="exampleSource() === 'support'"
                          [attr.aria-selected]="exampleSource() === 'support'"
                          [disabled]="translating() || askingPolish() !== null"
                          (click)="workExample('support')"
                        >
                          {{ translationLanguageName() }}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          [class.on]="exampleSource() === 'working'"
                          [attr.aria-selected]="exampleSource() === 'working'"
                          [disabled]="translating() || askingPolish() !== null"
                          (click)="workExample('working')"
                        >
                          {{ originalLanguageName() }}
                        </button>
                      </div>
                    } @else {
                      <label class="field-label" [attr.for]="'play-example-' + prompt">
                        Example
                      </label>
                    }
                    <span class="header-actions">
                      @if (supportAvailable()) {
                        <span class="generate-bundle translate-split">
                          <button
                            type="button"
                            class="generate-main"
                            [attr.aria-label]="translating() ? 'Translating…' : 'Translate'"
                            [attr.title]="translating() ? 'Translating…' : 'Translate'"
                            [attr.aria-busy]="translating() ? true : null"
                            [disabled]="!canTranslateExample(prompt)"
                            (click)="translateExample(prompt)"
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
                        </span>
                      }
                      @if (!supportAvailable() || exampleSource() === 'working') {
                        <button
                          type="button"
                          class="icon-btn fix"
                          aria-label="Correct"
                          title="Correct"
                          [attr.aria-busy]="askingPolish() === 'correct' ? true : null"
                          [disabled]="!canCorrectExample(prompt)"
                          (click)="correctExample(prompt)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m6 16 6-12 6 12" />
                            <path d="M8 12h8" />
                            <path d="m16 20 2 2 4-4" />
                          </svg>
                        </button>
                      }
                    </span>
                  </div>
                  @if (!supportAvailable() || exampleSource() === 'working') {
                    @if (exampleCorrection(); as correction) {
                      <div class="compare-side fix">
                        <div class="field-heading">
                          <p class="field-label">Correction</p>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Dismiss"
                            (click)="exampleCorrection.set(null)"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                        <p class="hint">{{ correction }}</p>
                      </div>
                    }
                  }
                  @if (supportAvailable() && exampleSource() === 'support') {
                    <textarea
                      #exampleSupportField
                      [id]="'play-example-support-' + prompt"
                      rows="3"
                      [attr.aria-label]="translationLanguageName()"
                      [value]="exampleSupportDraftAt(prompt)"
                      [attr.maxlength]="exampleLengthMax"
                      [disabled]="
                        askingExampleGrade() === prompt || translating() || askingPolish() !== null
                      "
                      placeholder="Write an example"
                      (input)="onExampleSupportDraft(prompt, $event)"
                    ></textarea>
                  } @else {
                    <textarea
                      #exampleField
                      [id]="'play-example-' + prompt"
                      rows="3"
                      [value]="exampleDraftAt(prompt)"
                      [attr.maxlength]="exampleLengthMax"
                      [disabled]="
                        askingExampleGrade() === prompt || translating() || askingPolish() !== null
                      "
                      [attr.aria-label]="supportAvailable() ? originalLanguageName() : 'Example'"
                      placeholder="Write an example"
                      (input)="onExampleDraft(prompt, $event)"
                    ></textarea>
                  }
                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                  <div class="sheet-actions">
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="aiBusy() || translating() || !exampleReady(prompt)"
                      (click)="submitExample(prompt)"
                    >
                      Submit
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="askingExampleGrade() === prompt"
                      (click)="giveUpExample(prompt)"
                    >
                      Give up
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="askingExampleGrade() === prompt"
                      (click)="examplePrompt.set(-1)"
                    >
                      Cancel
                    </button>
                  </div>
                }
              </section>
            </div>
          }
        }

        @if (titleEdit()) {
          <div class="sheet-backdrop" (click)="closeTitle($event)">
            <form
              class="sheet element-edit"
              role="dialog"
              aria-modal="true"
              aria-label="Edit element"
              (click)="$event.stopPropagation()"
              (submit)="saveTitle($event)"
            >
              <div class="sheet-head">
                <h3>Edit element</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  [disabled]="busy()"
                  (click)="cancelTitle()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <label for="element-title">Title</label>
              <input
                id="element-title"
                aria-label="Title"
                [value]="titleDraft()"
                [attr.maxlength]="formMaxLength"
                autocomplete="off"
                [disabled]="busy()"
                (input)="titleDraft.set(inputValue($event))"
              />
              @if (titleError()) {
                <p class="error">{{ titleError() }}</p>
              }
              <app-highlight-color-picker
                [embedded]="true"
                [color]="element().color"
                [colors]="colors()"
                [disabled]="busy()"
                (changed)="colorDraft.set($event)"
              />
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="busy()"
                  (click)="cancelTitle()"
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary" [disabled]="!canSaveElement()">
                  Save
                </button>
              </div>
            </form>
          </div>
        }

        @if (!definitionInPlay(exerciseLog()) && statsDefinition(); as definition) {
          @let index = exerciseLog();
          <div class="sheet-backdrop" (click)="closeExerciseLog($event)">
            <section
              class="sheet definition-stats"
              role="dialog"
              aria-modal="true"
              aria-label="Stats"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>Stats</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="closeExerciseLog()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="stats-summary">
                <section class="stats-block">
                  <h3>Exercises</h3>
                  <ul class="stats-gems">
                    @for (row of exerciseStats; track row.game) {
                      @if (row.game !== 'translation' || supportAvailable()) {
                        <li
                          [attr.data-game]="row.game"
                          [attr.aria-label]="
                            exerciseAverageLabel(definition, row.game, modeLabel(row.mode))
                          "
                        >
                          <span class="stats-stone" aria-hidden="true">
                            <app-mode-icon class="stats-stone-icon" [mode]="row.mode" />
                          </span>
                          @if (exerciseAverage(definition, row.game); as average) {
                            <span class="stats-count">
                              {{ average }}<span class="score-max">/5</span>
                            </span>
                          } @else {
                            <span class="stats-count stats-na">N/A</span>
                          }
                          <span class="stats-caption">{{ modeLabel(row.mode) }}</span>
                        </li>
                      }
                    }
                  </ul>
                </section>
                <section class="stats-block">
                  <h3>Activity</h3>
                  <ul class="stats-activity">
                    @let seen = activityCount(definition, 'view');
                    @let reworked = activityCount(definition, 'rework');
                    @let revealed = activityCount(definition, 'reveal');
                    <li [attr.aria-label]="activityLabel('view', seen)">
                      <span class="stats-well" aria-hidden="true">
                        <svg class="stats-mark" viewBox="0 0 24 24">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </span>
                      <span class="stats-count">{{ seen }}</span>
                      <span class="stats-caption">Seen</span>
                    </li>
                    <li [attr.aria-label]="activityLabel('rework', reworked)">
                      <span class="stats-well" aria-hidden="true">
                        <svg class="stats-mark" viewBox="0 0 24 24">
                          <path
                            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                          />
                        </svg>
                      </span>
                      <span class="stats-count">{{ reworked }}</span>
                      <span class="stats-caption">Reworked</span>
                    </li>
                    <li [attr.aria-label]="activityLabel('reveal', revealed)">
                      <span class="stats-well" aria-hidden="true">
                        <app-reveal-icon />
                      </span>
                      <span class="stats-count">{{ revealed }}</span>
                      <span class="stats-caption">Revealed</span>
                    </li>
                  </ul>
                </section>
              </div>
              @if (definitionHistory(definition).length) {
                <section class="stats-log">
                  <h3>History</h3>
                  <div class="add-choices">
                    <ng-template #historyDelete let-historyIndex="historyIndex">
                      <button
                        type="button"
                        class="icon-btn danger log-delete"
                        aria-label="Delete"
                        title="Delete"
                        [disabled]="busy()"
                        (click)="askDeleteExercise(index, historyIndex)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </ng-template>
                    @for (entry of definitionHistory(definition); track $index) {
                      @if (
                        entry.event === 'view' ||
                        (entry.event === 'reveal' && !entry.phrase && !entry.translation)
                      ) {
                        <div
                          class="log-row log-plain"
                          [attr.aria-label]="historyAria(definition, entry)"
                        >
                          <span class="log-copy">
                            <span class="log-game">{{ historyTitle(entry) }}</span>
                            <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                          </span>
                          <ng-container
                            [ngTemplateOutlet]="historyDelete"
                            [ngTemplateOutletContext]="{ historyIndex: $index }"
                          />
                        </div>
                      } @else {
                        <div class="log-item">
                          <div class="log-row">
                          <button
                            type="button"
                            class="log-open"
                            [attr.aria-expanded]="exerciseEntry() === $index"
                            [attr.aria-label]="historyAria(definition, entry)"
                            (click)="toggleExerciseEntry($index)"
                          >
                            <span class="log-copy">
                              <span class="log-game">{{ historyTitle(entry) }}</span>
                              <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                            </span>
                            <span class="log-side">
                              @if (entry.event === 'game') {
                                <span
                                  class="score-readout"
                                  [attr.data-game]="entry.game"
                                  aria-hidden="true"
                                >
                                  @if (earnedGameGem(definition, entry)) {
                                    <app-gem-icon class="gem-gain-stone" [game]="entry.game" />
                                  }
                                  {{ entry.score }}<span class="score-max">/5</span>
                                </span>
                              }
                              <svg
                                class="log-chevron"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                [class.open]="exerciseEntry() === $index"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </span>
                          </button>
                          <ng-container
                            [ngTemplateOutlet]="historyDelete"
                            [ngTemplateOutletContext]="{ historyIndex: $index }"
                          />
                          </div>
                          @if (exerciseEntry() === $index) {
                            <div class="log-detail">
                              <ng-template
                                #historyPassage
                                let-text="text"
                                let-equivalent="equivalent"
                                let-metadata="metadata"
                                let-kind="kind"
                              >
                                @let passage = parsePassage(text);
                                @if (passage.text) {
                                  <p class="passage">{{ shownDefinition(passage.text) }}</p>
                                }
                                @let translations = shownTranslations(passage);
                                @if (translations.length) {
                                  <ul class="equivalents">
                                    @for (translation of translations; track $index) {
                                      <li>{{ labeledTranslation(translation) }}</li>
                                    }
                                  </ul>
                                }
                                @if (equivalent || entries(metadata ?? {}).length) {
                                  <ul class="sense-meta">
                                    @if (equivalent) {
                                      <li class="sense-equivalent">
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                          <path d="m5 8 6 6" />
                                          <path d="m4 14 6-6 2-3" />
                                          <path d="M2 5h12" />
                                          <path d="M7 2h1" />
                                          <path d="m22 22-5-10-5 10" />
                                          <path d="M14 18h6" />
                                        </svg>
                                        <span>{{ equivalent }}</span>
                                      </li>
                                    }
                                    @for (item of entries(metadata ?? {}); track item.key) {
                                      <li>
                                        <span class="sense-meta-key">{{ item.key }}</span>
                                        <span class="sense-meta-value">{{ item.value }}</span>
                                      </li>
                                    }
                                  </ul>
                                }
                              </ng-template>
                              @if (entry.event === 'reveal') {
                                @if (entry.phrase) {
                                  <p class="field-label">
                                    {{ entry.kind === 'example' ? 'Example' : 'Definition' }}
                                  </p>
                                  <p class="passage">{{ shownDefinition(entry.phrase) }}</p>
                                }
                                @if (entry.translation) {
                                  <p class="field-label">Translation</p>
                                  <p>{{ entry.translation }}</p>
                                }
                                <p class="hint">{{ exerciseWhen(entry.at) }}</p>
                              } @else if (entry.event === 'rework') {
                                @if (entry.before && entry.after) {
                                  <div class="compare">
                                    <div class="compare-side">
                                      <p class="field-label">Before</p>
                                      <ng-container
                                        [ngTemplateOutlet]="historyPassage"
                                        [ngTemplateOutletContext]="{
                                          text: entry.before.text,
                                          equivalent: entry.before.equivalent,
                                          metadata: entry.before.metadata,
                                          kind: 'definition',
                                        }"
                                      />
                                    </div>
                                    <div class="compare-side yours">
                                      <p class="field-label">After</p>
                                      <ng-container
                                        [ngTemplateOutlet]="historyPassage"
                                        [ngTemplateOutletContext]="{
                                          text: entry.after.text,
                                          equivalent: entry.after.equivalent,
                                          metadata: entry.after.metadata,
                                          kind: 'definition',
                                        }"
                                      />
                                    </div>
                                  </div>
                                } @else if (entry.before; as side) {
                                  <p class="field-label">Before</p>
                                  <ng-container
                                    [ngTemplateOutlet]="historyPassage"
                                    [ngTemplateOutletContext]="{
                                      text: side.text,
                                      equivalent: side.equivalent,
                                      metadata: side.metadata,
                                      kind: 'definition',
                                    }"
                                  />
                                } @else if (entry.after; as side) {
                                  <p class="field-label">After</p>
                                  <ng-container
                                    [ngTemplateOutlet]="historyPassage"
                                    [ngTemplateOutletContext]="{
                                      text: side.text,
                                      equivalent: side.equivalent,
                                      metadata: side.metadata,
                                      kind: 'definition',
                                    }"
                                  />
                                } @else {
                                  <p class="field-label">Reworked</p>
                                }
                                <p class="hint">{{ exerciseWhen(entry.at) }}</p>
                              } @else if (entry.event === 'example') {
                                @if (entry.snapshot; as snapshot) {
                                  <div class="equivalent-gloss">
                                    <p class="field-label">Definition</p>
                                    <ng-container
                                      [ngTemplateOutlet]="historyPassage"
                                      [ngTemplateOutletContext]="{
                                        text: snapshot.text,
                                        equivalent: snapshot.equivalent,
                                        kind: 'definition',
                                      }"
                                    />
                                  </div>
                                }
                                @if (entry.example) {
                                  <div class="compare-side yours">
                                    <p class="field-label">Example</p>
                                    <ng-container
                                      [ngTemplateOutlet]="historyPassage"
                                      [ngTemplateOutletContext]="{
                                        text: entry.example,
                                        equivalent: '',
                                        kind: 'example',
                                      }"
                                    />
                                  </div>
                                }
                                <p class="hint">{{ exerciseWhen(entry.at) }}</p>
                              } @else if (entry.event === 'form') {
                                @if (entry.snapshot; as snapshot) {
                                  <div class="equivalent-gloss">
                                    <p class="field-label">Definition</p>
                                    <ng-container
                                      [ngTemplateOutlet]="historyPassage"
                                      [ngTemplateOutletContext]="{
                                        text: snapshot.text,
                                        equivalent: snapshot.equivalent,
                                        kind: 'definition',
                                      }"
                                    />
                                  </div>
                                }
                                @if (entry.forms.length) {
                                  <ul class="forms">
                                    @for (form of entry.forms; track form) {
                                      <li>
                                        <span class="form-chip readonly">
                                          <ng-container [ngTemplateOutlet]="formIcon" />
                                          {{ form }}
                                        </span>
                                      </li>
                                    }
                                  </ul>
                                }
                                <p class="hint">{{ exerciseWhen(entry.at) }}</p>
                              } @else {
                                @let passage =
                                  parsePassage(entry.snapshot?.text ?? definition.text);
                                @let gloss = passage.text;
                                @let equivalent =
                                  entry.snapshot?.equivalent ?? equivalentText(definition);
                                @if (gloss && entry.answer && entry.game !== 'definition') {
                                  <div class="equivalent-gloss">
                                    <p class="field-label">Definition</p>
                                    <p>{{ shownDefinition(gloss) }}</p>
                                    @let translations = shownTranslations(passage);
                                    @if (translations.length) {
                                      <ul class="equivalents">
                                        @for (translation of translations; track $index) {
                                          <li>{{ labeledTranslation(translation) }}</li>
                                        }
                                      </ul>
                                    }
                                  </div>
                                }
                                @if (!entry.answer) {
                                  <p class="field-label">You gave up</p>
                                  @if (entry.game === 'definition' || entry.game === 'example') {
                                    <p class="passage">{{ shownDefinition(gloss) }}</p>
                                    @let translations = shownTranslations(passage);
                                    @if (translations.length) {
                                      <ul class="equivalents">
                                        @for (translation of translations; track $index) {
                                          <li>{{ labeledTranslation(translation) }}</li>
                                        }
                                      </ul>
                                    }
                                  } @else if (equivalent) {
                                    <p class="equivalent-result">
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="m5 8 6 6" />
                                        <path d="m4 14 6-6 2-3" />
                                        <path d="M2 5h12" />
                                        <path d="M7 2h1" />
                                        <path d="m22 22-5-10-5 10" />
                                        <path d="M14 18h6" />
                                      </svg>
                                      <span>{{ equivalent }}</span>
                                    </p>
                                  }
                                } @else if (entry.game === 'example') {
                                  <div class="compare-side yours">
                                    <p class="field-label">You wrote</p>
                                    <p>{{ entry.answer }}</p>
                                  </div>
                                } @else {
                                  <div class="compare">
                                    <div class="compare-side">
                                      @if (entry.game === 'definition') {
                                        <p class="field-label">Definition</p>
                                        <p class="passage">{{ shownDefinition(gloss) }}</p>
                                        @let translations = shownTranslations(passage);
                                        @if (translations.length) {
                                          <ul class="equivalents">
                                            @for (translation of translations; track $index) {
                                              <li>{{ labeledTranslation(translation) }}</li>
                                            }
                                          </ul>
                                        }
                                      } @else {
                                        <p class="field-label">Equivalent</p>
                                        <p class="equivalent-result">
                                          <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="m5 8 6 6" />
                                            <path d="m4 14 6-6 2-3" />
                                            <path d="M2 5h12" />
                                            <path d="M7 2h1" />
                                            <path d="m22 22-5-10-5 10" />
                                            <path d="M14 18h6" />
                                          </svg>
                                          <span>{{ equivalent }}</span>
                                        </p>
                                      }
                                    </div>
                                    <div class="compare-side yours">
                                      <p class="field-label">You wrote</p>
                                      <p>{{ entry.answer }}</p>
                                    </div>
                                  </div>
                                }
                                <p class="field-label">Score</p>
                                <p
                                  class="score-readout"
                                  [attr.data-game]="entry.game"
                                  role="img"
                                  [attr.aria-label]="scoreAria(definition, entry)"
                                >
                                  @if (earnedGameGem(definition, entry)) {
                                    <app-gem-icon class="gem-gain-stone" [game]="entry.game" />
                                  }
                                  {{ entry.score }}<span class="score-max">/5</span>
                                </p>
                                @if (entry.explanation) {
                                  <p>{{ entry.explanation }}</p>
                                }
                                <p class="hint">
                                  {{ entry.by === 'ai' ? 'AI' : 'You' }} ·
                                  {{ exerciseWhen(entry.at) }}
                                </p>
                              }
                            </div>
                          }
                        </div>
                      }
                    }
                  </div>
                </section>
              }
            </section>
          </div>
        }

        @if (helpOpen()) {
          @if (shownPlayMode(); as mode) {
            <div class="sheet-backdrop" (click)="closeHelp($event)">
              <section
                class="sheet"
                role="dialog"
                aria-modal="true"
                aria-label="What to do"
                (click)="$event.stopPropagation()"
              >
                <div class="sheet-head">
                  <h3>{{ modeLabel(mode) }}</h3>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Close"
                    (click)="helpOpen.set(false)"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
                <p class="hint">{{ modeHelp(mode) }}</p>
                <div class="sheet-actions">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="aiBusy()"
                    (click)="giveUpGame()"
                  >
                    Give up
                  </button>
                </div>
              </section>
            </div>
          }
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
                    ? 'This element will be removed. All gems accumulated for it and all of its stats will disappear.'
                    : pending.kind === 'definitions'
                      ? 'Every definition will be removed.'
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
    @if (missingDefinitionsOpen()) {
      <app-missing-definitions-modal
        [language]="element().language"
        [title]="element().title"
        [definitions]="element().definitions"
        [saving]="missingSaving()"
        [saveError]="missingSaveError()"
        (closed)="closeMissingDefinitions()"
        (add)="addProposedDefinition($event)"
      />
    }
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
    }

    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 90%;
      height: min(90dvh, calc(100dvh - 2.5rem));
      max-height: calc(100dvh - 2.5rem);
      min-height: 0;
      overflow: hidden;
      --card-line: var(--border);
      --card-border: var(--border);
      --element-accent: #f43f5e;
      --header-inline: 1.15rem;
      --header-pad-left: 0.65rem;
      --title-lead: 0px;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .panel.has-color {
      --element-accent: oklch(from var(--swatch) 0.74 calc(min(max(c, 0.16), 0.24)) h);
    }

    header,
    .sheet-head,
    .section-heading,
    .sheet-actions,
    .sheet-tools {
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
      flex: none;
      flex-direction: column;
      align-items: stretch;
      gap: 0.7rem;
      padding: 0.9rem var(--header-inline) 0.9rem var(--header-pad-left);
      border-bottom: 1px solid var(--card-line);
    }

    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-width: 0;
    }

    .title-row h2,
    .title-main {
      flex: 1;
      min-width: 0;
    }

    .title-end {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex: none;
    }

    .header-actions .mode-btn {
      width: 1.8rem;
      height: 1.8rem;
      margin-inline-end: 0.15rem;
      border: 0;
      border-radius: 0.4rem;
    }

    .header-actions .mode-btn app-mode-icon {
      width: 1.35rem;
      height: 1.35rem;
    }

    .panel[data-mode='1'] {
      --scintilla: var(--gem-translation);
      --scintilla-rgb: 240, 90, 98;
      --scintilla-hot: #ffb4b6;
    }

    .panel[data-mode='2'] {
      --scintilla: var(--gem-example);
      --scintilla-rgb: 240, 148, 64;
      --scintilla-hot: #ffd0a6;
    }

    .panel[data-mode='3'] {
      --scintilla: var(--gem-definition);
      --scintilla-rgb: 72, 200, 80;
      --scintilla-hot: #b8f5bc;
    }

    .definition-cue-text {
      color: var(--text-muted);
      white-space: pre-wrap;
      filter: blur(0.55em);
      pointer-events: none;
      user-select: none;
      animation: blur-scintillate 1s linear infinite;
    }

    @keyframes blur-scintillate {
      0%,
      62%,
      100% {
        color: var(--scintilla);
        filter: blur(0.55em);
      }

      74%,
      86% {
        color: #fff;
        filter: blur(0.55em) drop-shadow(0 0 2px #fff) drop-shadow(0 0 8px var(--scintilla-hot));
      }
    }

    @keyframes click-scintillate {
      0%,
      62%,
      100% {
        color: var(--scintilla);
        box-shadow: 0 0 10px rgba(var(--scintilla-rgb), 0.28);
      }

      74%,
      86% {
        color: #fff;
        box-shadow:
          0 0 2px #fff,
          0 0 8px var(--scintilla-hot);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .definition-cue-text,
      .play-cta {
        animation: none;
      }
    }

    .title-main {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    .title-main h2 {
      flex: 0 1 auto;
      color: var(--text);
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
      width: 1.5rem;
      height: 1.5rem;
    }

    .element-edit {
      width: min(100%, 22rem);
    }

    .element-edit app-highlight-color-picker {
      margin-top: 0.2rem;
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-muted);
      font-size: 0.95rem;
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

    .equivalent-pills > li:not(:has(.equivalent-entry)) {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font-size: 0.8125rem;
    }

    .equivalent-pills > li.selected {
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
    }

    .equivalent-pills > li:not(:has(.equivalent-entry)) > button:first-child {
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      padding: 0.28rem 0.2rem 0.28rem 0.7rem;
    }

    .equivalent-pills > li:not(:has(.equivalent-entry)) > button.tag-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 0.12rem 0.55rem 0 0;
      line-height: 1;
    }

    .equivalent-choices li.entry-pill {
      display: inline-flex;
      align-items: center;
      flex: none;
      max-width: 100%;
      border: 1px dashed var(--border);
      border-radius: 999px;
      background: transparent;
    }

    .equivalent-choices li.entry-pill:focus-within {
      border-style: solid;
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .equivalent-choices .equivalent-entry {
      width: auto;
      max-width: 100%;
      padding: 0.28rem 0.15rem 0.28rem 0.7rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      font-size: 0.8125rem;
      line-height: 1.2;
    }

    .equivalent-choices .equivalent-entry:focus {
      outline: none;
    }

    .entry-confirm {
      display: grid;
      place-items: center;
      flex: none;
      width: 1.35rem;
      height: 1.35rem;
      margin-right: 0.15rem;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--accent-text);
      cursor: pointer;
    }

    .equivalent-choices button.entry-confirm,
    .pills button.entry-confirm {
      border: 0;
      background: transparent;
      padding: 0;
    }

    .entry-confirm svg {
      width: 0.85rem;
      height: 0.85rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .entry-confirm:disabled {
      color: var(--text-muted);
      opacity: 0.4;
      cursor: not-allowed;
    }

    .equivalent-block {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      min-width: 0;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
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
      width: 1.8rem;
      height: 1.8rem;
      border-radius: 0.4rem;
    }

    .close:hover,
    .icon-btn:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .icon-btn {
      position: relative;
      width: 1.8rem;
      height: 1.8rem;
      border-radius: 0.4rem;
    }

    .icon-btn.hear-inline {
      width: 1.5rem;
      height: 1.5rem;
      margin-inline-end: 0.15rem;
      vertical-align: -0.3em;
    }

    .icon-btn.hear-inline svg {
      width: 1.05rem;
      height: 1.05rem;
    }

    .title-main .icon-btn.hear-inline {
      width: 1.8rem;
      height: 1.8rem;
      margin-inline: 0;
      vertical-align: unset;
    }

    .title-main .icon-btn.hear-inline svg {
      width: 1.15rem;
      height: 1.15rem;
    }

    .spoken {
      display: flex;
      align-items: flex-start;
      gap: 0.15rem;
      max-width: 100%;
    }

    .spoken > .spoken-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .spoken > .icon-btn.hear-inline {
      flex: none;
      margin: 0;
      margin-block-start: calc((1.45em - 1.5rem) / 2);
      vertical-align: unset;
    }

    .example-quote > .spoken > .icon-btn.hear-inline {
      width: 1.75rem;
      height: 1.75rem;
      margin-block-start: calc((1.5em - 1.75rem) / 2);
      border-radius: 999px;
      background: color-mix(in srgb, var(--element-accent) 16%, transparent);
      color: var(--element-accent);
    }

    .example-quote > .spoken > .icon-btn.hear-inline:hover:not(:disabled) {
      background: color-mix(in srgb, var(--element-accent) 28%, transparent);
      color: var(--element-accent);
    }

    .example-quote > .spoken > .icon-btn.hear-inline.active,
    .example-quote > .spoken > .icon-btn.hear-inline.active:hover:not(:disabled) {
      color: var(--element-accent);
      background: color-mix(in srgb, var(--element-accent) 32%, transparent);
    }

    .example-quote > .spoken > .icon-btn.hear-inline svg {
      width: 0.9rem;
      height: 0.9rem;
    }

    .example-quote > .spoken {
      align-items: flex-start;
      gap: 0.75rem;
    }

    .sense > .group > .section-heading > .section-title,
    .sense > .group > .section-title,
    .sense > .group > .examples,
    .sense > .group > .forms {
      margin-inline-start: var(--phrase-indent, 0);
    }

    .sense-main .spoken {
      gap: 0.75rem;
    }

    .sense-main .spoken > .icon-btn.hear-inline {
      width: 1.75rem;
      height: 1.75rem;
      margin-block-start: 0.1rem;
      border-radius: 0.5rem;
      background: var(--surface-2);
      color: #cbd5e1;
    }

    .sense-main .spoken > .icon-btn.hear-inline:hover:not(:disabled) {
      color: #fb7185;
      background: var(--surface-2);
    }

    .sense-main .spoken > .icon-btn.hear-inline.active,
    .sense-main .spoken > .icon-btn.hear-inline.active:hover:not(:disabled) {
      color: var(--accent-text);
      background: var(--accent-soft);
    }

    .sense-main .spoken > .icon-btn.hear-inline svg {
      width: 0.9rem;
      height: 0.9rem;
    }

    .example-quote {
      --phrase-indent: 0;
    }

    .example-quote > .pills {
      margin-inline-start: var(--phrase-indent, 0);
    }

    .saved-example > .item-actions {
      align-self: stretch;
      justify-content: flex-end;
      margin-inline: 0 -0.2rem;
      padding-inline: 0 0.15rem;
    }

    .sense-copy > .lookup-actions,
    .saved-example > .lookup-actions {
      justify-content: flex-start;
      margin-top: 0.35rem;
      margin-left: 0;
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

    .icon-btn.danger:hover:not(:disabled) {
      color: var(--danger);
      background: rgba(255, 92, 122, 0.12);
    }

    .icon-btn.fix,
    .icon-btn.fix:hover:not(:disabled) {
      color: var(--danger);
    }

    .icon-btn.idea,
    .icon-btn.idea:hover:not(:disabled) {
      color: var(--accent-text);
    }

    .compare-side.fix {
      border-color: #944662;
      background: #392237;
    }

    .compare-side.fix .field-label {
      color: var(--danger);
    }

    .compare-side.idea {
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .compare-side.idea .field-label {
      color: var(--accent-text);
    }

    .close svg,
    .icon-btn svg,
    h3.section-title svg,
    .lookup-chip svg,
    .equivalent-prompt svg,
    .forms-toggle svg,
    .log-chevron,
    .form-chip svg,
    .form-attributes-title svg,
    .engineer-forms .equivalent-choices svg,
    .sense-equivalent svg,
    .equivalent-result svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .close svg,
    .icon-btn svg {
      display: block;
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
    }

    .field-heading .lang {
      align-self: center;
    }

    .icon-btn svg .solid {
      fill: currentColor;
      stroke: none;
    }

    .color-btn svg .nib {
      fill: oklch(from var(--swatch) 0.74 calc(min(max(c, 0.16), 0.24)) h);
      stroke: none;
    }

    .color-btn.has-color:hover:not(:disabled) svg .nib {
      fill: oklch(from var(--swatch) 0.84 calc(min(max(c, 0.16), 0.24)) h);
    }

    .item-actions,
    .item-actions-main {
      display: flex;
      align-items: center;
      gap: 0.15rem;
      min-width: 0;
    }

    .item-actions {
      justify-content: flex-end;
    }

    .lookup-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 0.35rem;
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
      width: 1.15rem;
      height: 1.15rem;
    }

    .lookup-chip:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .lookup-chip.selected {
      background: rgba(var(--accent-rgb), 0.16);
    }

    .body {
      box-sizing: border-box;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 0.85rem var(--header-inline) 0.75rem calc(var(--header-pad-left) + var(--title-lead));
    }

    .definition-footer {
      flex: none;
      padding: 1rem var(--header-inline) 1rem calc(var(--header-pad-left) + var(--title-lead));
      border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
      background: color-mix(in srgb, var(--surface) 95%, transparent);
    }

    .example-slot {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      margin: 0;
    }

    .example-slot-field {
      display: flex;
      align-items: stretch;
      min-width: 0;
      gap: 0;
      padding-right: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 0.9rem;
      background: var(--surface-2);
    }

    .example-slot-field:focus-within {
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .example-slot-field input {
      flex: 1;
      width: auto;
      min-width: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .example-slot-field input:focus {
      outline: none;
    }

    .example-slot-field input:disabled {
      opacity: 0.6;
    }

    .example-slot-field.arrived {
      align-items: flex-start;
      gap: 0.35rem;
      overflow: visible;
      padding: 0;
      border: 0;
      background: transparent;
    }

    .example-slot-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
      margin: 0;
      padding: 0.45rem 0.2rem 0.45rem 0;
      color: var(--text);
      font-size: 0.92rem;
      line-height: 1.4;
    }

    .example-slot-text p {
      margin: 0;
    }

    .example-slot-gloss {
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    .example-slot-submit {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      align-self: stretch;
      width: 2.6rem;
      height: auto;
      margin: -1px -1px -1px 0;
      border: 0;
      border-radius: 0;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      color: white;
      box-shadow: none;
      cursor: pointer;
    }

    .example-slot-field.arrived .example-slot-submit {
      align-self: flex-start;
      width: 2.4rem;
      height: 2.4rem;
      margin: 0;
      border-radius: 0.7rem;
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
    }

    .example-slot-submit:hover:not(:disabled) {
      opacity: 0.95;
    }

    .example-slot-submit:active:not(:disabled) {
      transform: scale(0.98);
    }

    .example-slot-submit:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .example-slot-submit svg {
      display: block;
      width: 1.05rem;
      height: 1.05rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .example-slot-hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.75rem;
      line-height: 1.35;
      text-align: center;
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
      color: var(--text);
    }

    h3.section-title svg {
      display: block;
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
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

    .sense-toolbar {
      display: flex;
      flex-flow: row nowrap;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }

    .sense-pager {
      display: flex;
      align-items: center;
      gap: 0.05rem;
      min-width: 0;
      color: #94a3b8;
    }

    .sense-pager .icon-btn {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 0.25rem;
    }

    .sense-pager .icon-btn svg {
      width: 0.9rem;
      height: 0.9rem;
    }

    .definition-order {
      display: inline-flex;
      align-items: center;
      flex: none;
      height: 1.75rem;
      padding: 0 0.15rem;
      cursor: text;
      color: #94a3b8;
      font-size: 0.8125rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .definition-order:has(.order-input:disabled) {
      cursor: default;
    }

    .order-input {
      width: calc(var(--digits, 1) * 1ch + 0.1rem);
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      appearance: none;
      background: transparent;
      color: var(--element-accent);
      font: inherit;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      text-align: end;
      caret-color: var(--element-accent);
    }

    .order-input:focus {
      outline: none;
    }

    .order-input:disabled {
      cursor: default;
    }

    .sense-actions {
      display: flex;
      align-items: center;
      flex: none;
      gap: 0.05rem;
      margin-left: auto;
      color: #94a3b8;
    }

    .sense-actions .icon-btn {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 0.25rem;
    }

    .sense-actions .icon-btn svg {
      width: 0.9rem;
      height: 0.9rem;
    }

    .sense-actions .icon-btn.danger:hover:not(:disabled) {
      color: #fb7185;
      background: rgba(244, 63, 94, 0.2);
    }

    .sense {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: 1rem;
      background: var(--surface);
    }

    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin-block: 0;
      margin-inline: var(--phrase-indent, 0) 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      height: auto;
      padding: 0.25rem 0.625rem;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 0.5rem;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.6875rem;
      line-height: 1.2;
      white-space: nowrap;
    }

    .sense-meta li app-reveal {
      line-height: 1;
    }

    .sense-meta-key {
      margin-right: 0.35rem;
      font-weight: 500;
      letter-spacing: 0.02em;
    }

    .sense-meta-value {
      color: var(--text);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .sense-meta li.sense-equivalent {
      gap: 0.35rem;
      height: auto;
      min-height: 0;
      border-radius: 999px;
      border-color: var(--accent-border);
      background: var(--accent-soft);
      color: var(--accent-text);
      font-weight: 600;
      white-space: normal;
    }

    .sense-equivalent svg {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
    }

    .sense-meta li.sense-equivalent app-reveal,
    .sense-meta li.sense-equivalent .guess-answer {
      color: var(--text);
    }

    .sense-meta li.sense-equivalent:has(.guess-open) {
      padding: 0;
      border: 0;
      background: transparent;
      height: auto;
    }

    .guess-open {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      height: 1.85rem;
      margin: 0;
      padding: 0 0.5rem;
      border: 1px solid var(--accent-border);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-text);
      font: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
    }

    .guess-open:hover {
      background: rgba(var(--accent-rgb), 0.16);
    }

    .equivalent-prompt {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      gap: 0.35rem;
      color: var(--accent);
      font-weight: 650;
    }

    .equivalent-prompt svg {
      width: 1.05rem;
      height: 1.05rem;
      flex: none;
    }

    .equivalent-prompt .play-blur {
      color: var(--text);
    }

    .pills li.colored {
      gap: 0.4rem;
      background: color-mix(in srgb, var(--meta-color) 30%, var(--surface-2));
      color: var(--meta-color);
    }

    .pills li.colored .sense-meta-key {
      margin-right: 0;
      color: var(--meta-color);
    }

    .sense-meta .sense-meta-key {
      margin-right: 0;
      color: #94a3b8;
    }

    .sense-meta .sense-meta-value {
      color: var(--text);
      font-size: inherit;
      font-weight: 600;
    }

    .sense-meta li.colored .sense-meta-value {
      color: var(--meta-color);
    }

    .sense-main {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .sense-copy {
      position: relative;
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }

    .sense-copy .passage {
      font-size: 0.95rem;
      font-weight: 500;
      line-height: 1.625;
      color: #f1f5f9;
    }

    .sense-copy .equivalents {
      margin: 0;
      color: #94a3b8;
      font-size: 0.75rem;
      font-style: italic;
      line-height: 1.4;
    }

    .passage {
      white-space: pre-wrap;
      line-height: 1.45;
    }

    .linguagem-highlighted {
      background: transparent;
      color: inherit;
      border-bottom: none;
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-color: oklch(
        from var(--score-color, var(--accent)) 0.74 calc(min(max(c, 0.16), 0.24)) h
      );
      text-decoration-thickness: 2px;
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
      background: color-mix(
        in srgb,
        oklch(from var(--score-color, var(--accent)) 0.68 calc(min(max(c, 0.13), 0.18)) h) 42%,
        transparent
      );
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }

    .sense .linguagem-highlighted--current,
    .example-quote .linguagem-highlighted--current {
      border: 1px solid color-mix(in srgb, var(--element-accent) 45%, transparent);
      border-radius: 0.25rem;
      padding: 0.05rem 0.35rem;
      background: color-mix(in srgb, var(--element-accent) 28%, transparent);
      color: color-mix(in srgb, var(--element-accent) 30%, white);
      font-weight: 600;
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
      margin-top: 0.15rem;
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

    .form-chip {
      box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--text) 55%, transparent);
    }

    .pills li.colored {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--meta-color) 62%, transparent);
    }

    .pills li.colored > button:first-child,
    .pills li.colored > span {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }

    .form-chip button,
    .pills button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .form-chip > button:first-child {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .form-chip svg {
      display: block;
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
    }

    .form-chip > button:first-child,
    .pills li > button:first-child,
    .pills li > span {
      padding: 0.2rem 0.15rem 0.2rem 0.55rem;
    }

    .form-chip > button:only-child {
      padding-inline: 0.55rem;
    }

    .pills li > span {
      padding-inline-end: 0.55rem;
    }

    .tag-remove {
      padding: 0.2rem 0.45rem 0.2rem 0.15rem;
      line-height: 1;
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
      position: relative;
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
      padding: 0.1rem 0;
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .example-quote .passage {
      margin: 0;
      line-height: 1.5;
    }

    .example-quote .equivalents {
      margin-top: 0.125rem;
      color: #94a3b8;
      font-size: 0.75rem;
      font-weight: 400;
      font-style: normal;
    }

    .sense > .group > .examples .example-quote {
      padding: 0.75rem;
      border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--surface-2) 90%, transparent);
      color: #e2e8f0;
      font-size: 0.875rem;
      font-style: normal;
      font-weight: 500;
    }

    .sense > .group > .examples .example-quote .passage {
      font-weight: 500;
    }

    .sense > .group > .examples .example-quote .pills {
      font-style: normal;
      font-weight: 400;
    }

    .sense > .group > .forms .form-chip.readonly {
      border-style: solid;
      border-color: rgba(51, 65, 85, 0.6);
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-2) 80%, transparent);
      color: #e2e8f0;
      padding: 0.25rem 0.625rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.75rem;
      font-weight: 400;
    }

    .sense > .group > .forms .form-chip.readonly.tinted {
      background: color-mix(in srgb, var(--form-color) 15%, transparent);
      border-color: color-mix(in srgb, var(--form-color) 30%, transparent);
      color: var(--form-color);
      font-weight: 600;
    }

    button.form-chip {
      font: inherit;
      line-height: inherit;
      text-align: start;
      cursor: pointer;
    }

    .form-attributes-title {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
    }

    .form-attributes-title svg {
      width: 1rem;
      height: 1rem;
      flex: none;
    }

    .form-chip > button.form-edit {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.2rem 0.2rem 0.1rem;
    }

    .form-chip > button.form-edit svg {
      width: 0.85rem;
      height: 0.85rem;
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

    .pills li.meta-entry {
      flex: none;
      max-width: 100%;
      gap: 0.15rem;
      padding: 0 0.2rem;
      border: 1px dashed var(--border);
      background: transparent;
    }

    .pills li.meta-entry:focus-within {
      border-style: solid;
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .pills li.meta-entry input {
      width: auto;
      max-width: 14rem;
      padding: 0.28rem 0.35rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      font-size: 0.8125rem;
      line-height: 1.2;
    }

    .pills li.meta-entry input:focus {
      outline: none;
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

    .add-choices {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .add-choice {
      width: 100%;
      border-radius: 12px;
    }

    .add-choice[aria-pressed='true'] {
      border-color: var(--accent);
      color: var(--accent-text);
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

    .definition-stats {
      gap: 0.85rem;
    }

    .stats-summary,
    .stats-log {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .stats-log {
      gap: 0.55rem;
    }

    .stats-hero {
      display: flex;
      flex-direction: column;
      gap: 0.28rem;
      padding: 1rem 1.05rem 0.95rem;
      border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);
      border-radius: 1.05rem;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--accent) 18%, transparent),
        color-mix(in srgb, var(--accent) 7%, rgba(8, 10, 18, 0.35))
      );
    }

    .stats-eyebrow,
    .definition-stats .stats-block > h3 {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .stats-hero-value,
    .stats-count {
      margin: 0;
      color: var(--text);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .stats-hero-value {
      font-size: 2.7rem;
      font-weight: 700;
      letter-spacing: -0.045em;
      line-height: 0.95;
    }

    .stats-block {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 0;
    }

    .stats-gems,
    .stats-activity {
      display: grid;
      gap: 0.45rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .stats-gems {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats-activity {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats-gems li,
    .stats-activity li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      min-width: 0;
      padding: 0.85rem 0.55rem 0.7rem;
      border-radius: 1.05rem;
    }

    .stats-gems li {
      border: 1px solid color-mix(in srgb, var(--exercise-gem) 32%, transparent);
      background: color-mix(in srgb, var(--exercise-gem) 13%, rgba(8, 10, 18, 0.55));
    }

    .stats-activity li {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.035);
      color: var(--text-muted);
    }

    .stats-stone,
    .stats-well {
      display: grid;
      place-items: center;
      margin-bottom: 0.28rem;
      border-radius: 0.7rem;
    }

    .stats-stone {
      width: 2.35rem;
      height: 2.35rem;
      background: color-mix(in srgb, var(--exercise-gem) 16%, rgba(6, 8, 16, 0.82));
      color: var(--exercise-gem);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--exercise-gem) 38%, transparent);
    }

    .stats-stone-icon {
      width: 1.45rem;
      height: 1.45rem;
    }

    .stats-gems .stats-count {
      color: var(--exercise-gem);
    }

    .stats-count .score-max {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }

    .stats-gems .stats-count.stats-na {
      color: var(--text-muted);
      font-size: 1.15rem;
      letter-spacing: 0.04em;
    }

    .stats-gems:not(:has(> li:nth-child(3))) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .stats-well {
      width: 2.15rem;
      height: 2.15rem;
      background: rgba(8, 10, 18, 0.45);
      color: var(--text-muted);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    }

    .stats-mark {
      display: block;
      width: 0.95rem;
      height: 0.95rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .stats-count {
      font-size: 1.55rem;
      font-weight: 700;
    }

    .stats-caption {
      max-width: 100%;
      color: var(--text-muted);
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }

    .editor-sheet {
      align-self: stretch;
      height: 100%;
      min-height: 0;
      max-height: 100%;
      overflow: hidden;
      gap: 0;
      padding-bottom: 0;
    }

    .editor-sheet textarea {
      resize: none;
    }

    .editor-sheet > .sheet-head,
    .editor-sheet > .lang.work-tabs {
      flex: none;
      margin-bottom: 0.55rem;
    }

    .sheet-scroll {
      flex: none;
      overflow: visible;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .editor-sheet > .sheet-scroll {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .sheet-scroll > .work-section {
      min-width: 0;
      padding-inline: 0.7rem;
    }

    .sheet-scroll > .work-section:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .play-cta {
      align-self: flex-start;
      gap: 0.55rem;
      color: var(--scintilla);
      border-color: rgba(var(--scintilla-rgb), 0.78);
      background: rgba(var(--scintilla-rgb), 0.14);
      box-shadow: 0 0 10px rgba(var(--scintilla-rgb), 0.28);
      animation: click-scintillate 1s linear infinite;
    }

    .play-cta-count {
      font-size: 0.75rem;
      font-weight: 650;
      opacity: 0.72;
    }

    .editor-sheet > .sheet-footer .btn {
      gap: 0.4rem;
    }

    .editor-sheet > .sheet-footer .btn svg,
    .work-section .sheet-actions .btn svg {
      width: 1rem;
      height: 1rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .editor-sheet > .sheet-footer {
      position: sticky;
      bottom: 0;
      flex: none;
      z-index: 2;
      margin: 0.7rem -1rem 0;
      padding: 0.75rem 1rem;
      background: var(--surface);
      border-top: 1px solid var(--border);
    }

    .sheet-part {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }

    .sheet-items {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sheet-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .sheet-item p {
      flex: 1;
      min-width: 0;
      margin: 0.15rem 0 0;
      color: var(--text);
      font-size: 0.92rem;
      line-height: 1.45;
    }

    .engineer-sheet {
      overflow: visible;
    }

    .engineer-sheet textarea {
      flex: none;
      height: 5.6rem;
      resize: none;
    }

    .engineer-forms {
      overflow: visible;
    }

    .engineer-forms .equivalent-choices button {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .engineer-forms .equivalent-choices svg {
      display: block;
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
    }

    .definition-slot {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      min-width: 0;
    }

    .definition-ai {
      display: flex;
      flex: none;
      flex-direction: column;
      gap: 0.45rem;
      min-width: 0;
      padding: 0.55rem 0.6rem;
      border-radius: 0;
      background: color-mix(in srgb, var(--accent) 34%, var(--bg));
      color: white;
    }

    .definition-ai .instruct-field {
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      color: white;
    }

    .definition-ai .instruct-field input {
      padding: 0.45rem 0.75rem;
      color: white;
    }

    .definition-ai .instruct-field input::placeholder {
      color: rgba(255, 255, 255, 0.72);
    }

    .definition-ai .entry-confirm {
      color: white;
    }

    .definition-ai .entry-confirm:disabled {
      color: rgba(255, 255, 255, 0.4);
    }

    .instruct-field {
      display: flex;
      align-items: center;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      padding-right: 0.2rem;
    }

    .instruct-field input {
      flex: 1;
      width: auto;
      min-width: 0;
      border: 0;
      background: transparent;
    }

    .instruct-field input:focus {
      outline: none;
    }

    .related-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .related-row .icon-btn {
      flex: none;
    }

    .related-scroll {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      margin: 0;
      padding: 0.1rem 0.45rem 0.1rem 0;
      overflow-x: auto;
      overflow-y: hidden;
      list-style: none;
    }

    .related-scroll::after {
      content: '';
      flex: none;
      width: 0.2rem;
    }

    .related-scroll li {
      flex: none;
    }

    .related-scroll .related-chip,
    .related-scroll .related-more {
      box-sizing: border-box;
      height: calc(0.8125rem * 1.2 + 0.56rem);
    }

    .related-scroll .related-chip {
      display: inline-flex;
      flex-direction: row;
      align-items: baseline;
      gap: 0.35rem;
      padding: 0.28rem 0.7rem;
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      color: white;
      font: inherit;
      font-size: 0.8125rem;
      line-height: 1.2;
      white-space: nowrap;
      cursor: pointer;
    }

    .related-scroll .related-chip.selected {
      background: white;
      color: var(--accent);
    }

    .related-chip {
      display: inline-flex;
      max-width: 100%;
      white-space: normal;
    }

    .related-scroll .relation {
      color: rgba(255, 255, 255, 0.72);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .related-scroll .related-word {
      color: white;
      font-weight: 650;
      white-space: nowrap;
    }

    .related-scroll .related-chip.selected .relation,
    .related-scroll .related-chip.selected .related-word {
      color: var(--accent);
    }

    .related-scroll .related-more {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: calc(0.8125rem * 1.2 + 0.56rem);
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      cursor: pointer;
    }

    .related-scroll .related-more svg {
      display: block;
      width: 0.95rem;
      height: 0.95rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .related-scroll .related-more:hover:not(:disabled) {
      background: var(--accent-hover);
    }

    .related-scroll .related-more:disabled {
      opacity: 0.45;
      cursor: not-allowed;
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

    .example-actions {
      align-items: center;
    }

    .generate-bundle {
      display: flex;
    }

    .generate-main {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 650;
      padding: 0.55rem 1rem;
      font-size: 0.9375rem;
      line-height: 1.1;
      cursor: pointer;
    }

    .generate-main:hover:not(:disabled) {
      background: var(--accent-hover);
    }

    .generate-main:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .field-heading .header-actions {
      gap: 0.4rem;
    }

    .translate-split .generate-main {
      padding: 0.28rem 0.65rem;
      opacity: 1;
    }

    .translate-split .generate-main svg {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .translate-split .generate-main:disabled {
      color: rgba(255, 255, 255, 0.4);
      opacity: 1;
    }

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid rgba(255, 92, 122, 0.55);
    }

    .btn-danger:hover:not(:disabled) {
      background: rgba(255, 92, 122, 0.12);
    }

    .play-blur {
      color: var(--text-muted);
      filter: blur(0.55em);
      pointer-events: none;
      user-select: none;
    }

    .compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.65rem;
      align-items: stretch;
    }

    .compare-side {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
      padding: 0.7rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .yours {
      background: #3a3e4a;
      border-color: #5c6170;
    }

    .equivalent-gloss {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .equivalent-gloss p:last-child {
      margin: 0;
    }

    .gem-pick,
    .gem-gain {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }

    [data-game='translation'] {
      --exercise-gem: var(--gem-translation);
    }

    [data-game='example'] {
      --exercise-gem: var(--gem-example);
    }

    [data-game='definition'] {
      --exercise-gem: var(--gem-definition);
    }

    .gem-gain {
      flex: none;
    }

    button.gem-gain {
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .log-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      height: auto;
      box-sizing: border-box;
      padding: 0.55rem 0.7rem;
      text-align: start;
    }

    .log-plain {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font-size: 0.9375rem;
    }

    .log-item {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
    }

    .log-item > .log-row {
      gap: 0.1rem;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .log-open {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }

    .log-detail {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0.15rem 0.75rem 0.75rem;
      border-top: 1px solid var(--border);
    }

    .log-detail .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .log-row .log-copy {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.12rem;
      min-width: 0;
    }

    .log-row .log-game {
      font-weight: 700;
      line-height: 1.2;
    }

    .log-row .hint {
      max-width: 100%;
      overflow: hidden;
      font-size: 0.75rem;
      font-weight: 550;
      line-height: 1.2;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .log-open .gem-pick {
      flex: none;
      flex-wrap: nowrap;
      gap: 0.12rem;
    }

    .log-open .gem-pick-stone {
      width: 1.05rem;
      height: 1.05rem;
      cursor: inherit;
    }

    .log-open .gem-gain-stone {
      --gem-size: 0.72rem;
    }

    .gem-gain-count {
      color: var(--exercise-gem);
      font-size: 0.8125rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .gem-gain-stone {
      --gem-size: 0.85rem;
    }

    .gem-pick-stone {
      display: inline-flex;
      width: 1.7rem;
      height: 1.7rem;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .gem-pick-stone .gem-gain-stone {
      opacity: 0.28;
    }

    .gem-pick-stone.on .gem-gain-stone {
      opacity: 1;
    }

    .gem-pick .btn.on {
      background: var(--exercise-gem);
      border-color: var(--exercise-gem);
      color: white;
    }

    .score-pick {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }

    .score-pick-value {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.15rem;
      height: 2.15rem;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.95rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }

    .score-pick-value.on,
    .score-pick-value.on:disabled {
      background: var(--exercise-gem, var(--accent));
      border-color: var(--exercise-gem, var(--accent));
      color: white;
      opacity: 1;
    }

    .score-pick-value:disabled {
      cursor: default;
    }

    .score-readout {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin: 0;
      color: var(--exercise-gem, var(--text));
      font-size: 1.35rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .score-readout .score-max {
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 650;
    }

    .log-row .score-readout {
      flex: none;
      font-size: 1rem;
    }

    .log-side {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex: none;
    }

    .log-chevron {
      width: 1rem;
      height: 1rem;
      flex: none;
      color: var(--text-muted);
      transition: transform 0.18s ease;
    }

    .log-chevron.open {
      transform: rotate(180deg);
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem max(0.65rem, env(safe-area-inset-right))
          max(0.65rem, env(safe-area-inset-bottom)) max(0.65rem, env(safe-area-inset-left));
      }

      .panel {
        width: 100%;
        height: min(92dvh, calc(100dvh - 1.3rem));
        max-height: calc(100dvh - 1.3rem);
        border-radius: 14px 14px 0 0;
      }

      .compare {
        grid-template-columns: 1fr;
      }
    }

    .lang {
      display: inline-flex;
      align-self: flex-start;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
    }

    .lang button {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      padding: 0.35rem 0.7rem;
      cursor: pointer;
    }

    .lang button.on {
      background: var(--surface);
      color: var(--text);
    }

    .lang button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .lang.work-tabs {
      display: flex;
      align-self: stretch;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding-inline: 0;
    }

    .lang.work-tabs button {
      flex: 1 1 0;
      min-width: 0;
      text-align: start;
      padding-inline: 0.7rem;
    }

    .work-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-width: 0;
      min-height: 1.8rem;
    }

    .work-title .work-title-text {
      min-width: 0;
      font-size: 0.78rem;
      font-weight: 650;
      line-height: 1.2;
      color: var(--text-muted);
    }

    .work-title .work-title-actions {
      flex: none;
    }

    .score {
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .equivalent-result {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      color: var(--accent-text);
      font-weight: 650;
    }

    .equivalent-result svg {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
    }

    .form-chip.readonly {
      gap: 0.35rem;
      padding: 0.2rem 0.55rem;
    }
  `,
})
export class ElementModal {
  readonly element = input.required<StoredElement>();
  readonly collection = input<StoredElement[]>([]);
  /** Presets and custom colors already saved, for the highlight picker. */
  readonly colors = input<readonly string[]>([]);
  readonly canGoBack = input(false);
  /** Definition to show when this element opens, including a return from Back. */
  readonly definitionIndex = input(0);
  /** Example sentence carried in from the element that opened this one. */
  readonly arrivedExample = input('');
  /** Play uses this card. `playMode` decides which field is typed. */
  readonly playing = input(false);
  /** Exercise for this session. Null while editing. */
  readonly playMode = input<ElementMode | null>(null);
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly deleted = output<void>();
  readonly visit = output<{ id: string; definition: number; example: string }>();
  readonly back = output<void>();
  readonly addSelection = output<{
    title: string;
    language: string;
    definition: number;
    example: string;
  }>();
  readonly addPrepared = output<PreparedElement>();

  readonly scores = Array.from({ length: TRANSLATION_GEM_MAX + 1 }, (_, score) => score);
  readonly equivalentMax = EQUIVALENT_MAX;
  readonly definitionMax = DEFINITION_MAX;
  readonly supportAvailable = computed(() => this.translationTarget() !== '');

  /** Stored gloss and example translations, hidden when this language has no support language. */
  shownTranslations(passage: ParsedPassage): ParsedPassage['translations'] {
    const target = this.translationTarget();
    if (!target) return [];
    return passage.translations.filter((item) => item.language === target);
  }

  labeledTranslation(translation: { text: string }): string {
    return translation.text.trim();
  }

  labeledEquivalent(text: string): string {
    return text.trim();
  }

  definitionActionLabel(definition: ElementDefinition): string {
    return this.supportAvailable() && !this.equivalentText(definition)
      ? 'Add an equivalent'
      : 'Edit definition';
  }
  readonly originalLanguageName = computed(
    () => languageDisplayName(this.element().language) || this.element().language,
  );
  readonly round = signal<PlayRound>(emptyPlayRound());
  readonly askingGrade = signal<number | null>(null);
  readonly askingEquivalentGrade = signal<number | null>(null);
  readonly equivalentGradeError = signal('');
  readonly equivalentPrompt = signal(-1);
  readonly definitionPrompt = signal(-1);
  readonly examplePrompt = signal(-1);
  readonly askingExampleGrade = signal<number | null>(null);
  private readonly rounds = new Map<string, PlayRound>();
  private gradeJob = 0;
  private equivalentGradeJob = 0;
  private exampleGradeJob = 0;
  private concedingGame = false;
  private alive = true;
  readonly formMaxLength = FORM_MAX_LENGTH;
  readonly metaKeyMaxLength = META_KEY_MAX_LENGTH;
  readonly metaValueMaxLength = META_VALUE_MAX_LENGTH;
  readonly exampleInstructionMax = MAX_EXAMPLE_INSTRUCTION;
  readonly modeLabel = elementModeLabel;
  readonly modeHelp = elementModeHelp;
  readonly exampleLengthMax = MAX_EXAMPLE_LENGTH;
  readonly definitionInstructionMax = MAX_DEFINITION_INSTRUCTION;
  readonly relatedPickMax = MAX_RELATED_PICKS;
  readonly parsePassage = parsePassage;
  readonly editor = signal<Editor | null>(null);
  readonly equivalentDraft = signal('');
  readonly equivalentIdDraft = signal<string | null>(null);
  readonly sheetEquivalents = signal<ElementEquivalent[]>([]);
  readonly textDraft = signal('');
  readonly translating = signal(false);
  readonly askingEquivalent = signal(false);
  readonly askingMetadata = signal(false);
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
  /** Definition that opened the collision menu. */
  private collisionDefinition = 0;
  private collisionExample = '';
  readonly passageSelection = signal<PassageSelection | null>(null);
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly shownDefinitions = computed(() => this.element().definitions);
  /** Index of the definition panel on screen. */
  readonly definitionPanel = signal(0);
  readonly visibleDefinitionIndex = computed(() => {
    const count = this.shownDefinitions().length;
    if (count === 0) return 0;
    return Math.min(this.definitionPanel(), count - 1);
  });
  readonly asking = signal(false);
  readonly addingSelection = signal(false);
  readonly titleEdit = signal(false);
  readonly titleDraft = signal('');
  readonly titleError = signal('');
  /** Color chosen in the element editor. Null clears it. */
  readonly colorDraft = signal<string | null>(null);
  readonly missingDefinitionsOpen = signal(false);
  readonly missingSaving = signal(false);
  readonly missingSaveError = signal('');
  readonly unveiledEquivalents = signal<ReadonlySet<string>>(new Set());
  /** Definition translations and the equivalent, opened together. */
  readonly supportRevealed = signal(false);
  readonly addingDefinitions = signal<'example' | null>(null);
  readonly definitionExample = signal('');
  /** Arrived example shown as text until it is placed. */
  readonly heldExample = signal('');
  readonly askingForms = signal<number | null>(null);
  readonly askingExamples = signal<number | null>(null);
  readonly workTab = signal<WorkTab>('definitions');
  readonly formAttributesView = signal<ElementForm | null>(null);
  /** Generated example waiting to be saved. */
  readonly exampleDraft = signal<ExampleDraft | null>(null);
  /** Generated forms waiting to be saved. */
  readonly pendingForms = signal<PendingForms | null>(null);
  readonly exampleError = signal('');
  readonly formsError = signal('');
  readonly askingRelated = signal<number | null>(null);
  readonly askingWording = signal<number | null>(null);
  readonly newGlosses = signal<ReadonlySet<string>>(new Set());
  readonly exampleSuggestions = signal<Record<string, ExampleSuggestion[]>>({});
  readonly exampleEngineer = signal<ExampleEngineer | null>(null);
  readonly definitionEngineer = signal<DefinitionEngineer | null>(null);
  readonly helpOpen = signal(false);
  readonly exerciseStats: readonly { game: DefinitionGameLog['game']; mode: ElementMode }[] = [
    { game: 'translation', mode: 1 },
    { game: 'example', mode: 2 },
    { game: 'definition', mode: 3 },
  ];
  readonly exerciseLog = signal(-1);
  readonly exerciseEntry = signal(-1);
  readonly error = signal('');
  readonly speaking = signal<string | null>(null);

  private editingTranslations = new Map<string, string>();
  /** Latest element written from this card, including a save that has not finished. */
  private written: StoredElement | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private busySaves = 0;
  private translateTicket = 0;
  private equivalentTicket = 0;
  private exampleJob = 0;
  private relatedJob = 0;
  private wordingJob = 0;
  private trackedElementId = '';
  /** Element and definition last recorded as viewed. */
  private viewedDefinitionKey = '';
  /** Element whose on-screen definition was marked viewed for this open. */
  private viewedElementKey = '';
  private engineerDrafts = new Map<string, EngineerDraft>();
  private definitionEngineerDrafts = new Map<string, DefinitionEngineerDraft>();
  private readonly editorSheet = viewChild<ElementRef<HTMLElement>>('editorSheet');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly draftField = viewChild<ElementRef<HTMLTextAreaElement>>('draftField');
  private readonly formField = viewChild<ElementRef<HTMLInputElement>>('formField');
  private readonly formFeatureField = viewChild<ElementRef<HTMLInputElement>>('formFeatureField');
  private readonly metaKeyField = viewChild<ElementRef<HTMLInputElement>>('metaKeyField');
  private readonly equivalentField = viewChild<ElementRef<HTMLInputElement>>('equivalentField');
  private readonly definitionField = viewChild<ElementRef<HTMLTextAreaElement>>('definitionField');
  private readonly supportField = viewChild<ElementRef<HTMLTextAreaElement>>('supportField');
  private readonly exampleField = viewChild<ElementRef<HTMLTextAreaElement>>('exampleField');
  private readonly exampleSupportField =
    viewChild<ElementRef<HTMLTextAreaElement>>('exampleSupportField');
  private readonly definitionBody = viewChild<ElementRef<HTMLElement>>('definitionBody');
  /** Which definition tab is showing. */
  readonly definitionSource = signal<'support' | 'working'>('support');
  readonly definitionPolishNote = signal<
    { task: 'correct'; explanation: string } | { task: 'reformulate'; options: string[] } | null
  >(null);
  /** Which example tab is showing. */
  readonly exampleSource = signal<'support' | 'working'>('support');
  readonly exampleCorrection = signal<string | null>(null);
  readonly askingPolish = signal<PolishDefinitionTask | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      this.endDeletePress();
      stopSpeaking();
    });
    effect(() => {
      if (this.supportAvailable()) return;
      this.equivalentPrompt.set(-1);
    });
    effect(() => {
      const id = this.element().id;
      if (id === this.trackedElementId) return;
      const definition = this.definitionIndex();
      this.trackedElementId = id;
      this.endDeletePress();
      this.deletePressHeld = false;
      this.written = null;
      this.stopSpeech();
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
      this.exampleDraft.set(null);
      this.pendingForms.set(null);
      this.exampleError.set('');
      this.formsError.set('');
      this.askingExamples.set(null);
      this.askingRelated.set(null);
      this.askingWording.set(null);
      this.exampleEngineer.set(null);
      this.definitionEngineer.set(null);
      this.equivalentPrompt.set(-1);
      this.definitionPrompt.set(-1);
      this.examplePrompt.set(-1);
      this.unveiledEquivalents.set(new Set());
      this.supportRevealed.set(false);
      this.helpOpen.set(false);
      this.exerciseLog.set(-1);
      this.exerciseEntry.set(-1);
      const arrived = this.arrivedExample().trim().slice(0, MAX_EXAMPLE_LENGTH);
      this.definitionExample.set(arrived);
      this.heldExample.set(arrived);
      this.formAttributesView.set(null);
      this.definitionPanel.set(definition > 0 ? definition : 0);
      this.addingDefinitions.set(null);
      this.missingDefinitionsOpen.set(false);
      this.missingSaving.set(false);
      this.missingSaveError.set('');
      this.equivalentTicket += 1;
      this.askingEquivalent.set(false);
      this.askingMetadata.set(false);
      this.askingGrade.set(null);
      this.askingEquivalentGrade.set(null);
      this.askingPolish.set(null);
      this.askingExampleGrade.set(null);
      this.definitionPolishNote.set(null);
      this.exampleCorrection.set(null);
      this.exampleSource.set('support');
      this.equivalentGradeError.set('');
      this.loadRound(id);
      this.engineerDrafts.clear();
      this.definitionEngineerDrafts = readRelatedDrafts(id);
      void this.commitStoredExamples(id);
      this.refreshNewDefinitions(id);
      void this.adoptStoredSuggestions(id);
    });
    effect(() => {
      const count = this.element().definitions.length;
      if (!this.playing()) return;
      this.seatRound(count);
    });
    effect(() => {
      const id = this.element().id;
      const count = this.element().definitions.length;
      queueMicrotask(() => {
        if (!this.alive || this.element().id !== id) return;
        if (!count) {
          this.viewedElementKey = '';
          this.viewedDefinitionKey = '';
          return;
        }
        this.noteOpenedDefinition(id);
      });
    });
    const stopWatchingExamples = watchExampleSuggestions((elementId) => {
      if (elementId !== this.trackedElementId) return;
      this.exampleSuggestions.set(readExampleSuggestions(elementId));
    });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('selectionchange', this.syncPassageSelection);
    document.addEventListener('pointerdown', this.onSelectionPointerDown, true);
    document.addEventListener('pointerup', this.syncPassageSelection, true);
    inject(DestroyRef).onDestroy(() => {
      stopWatchingExamples();
      document.removeEventListener('selectionchange', this.syncPassageSelection);
      document.removeEventListener('pointerdown', this.onSelectionPointerDown, true);
      document.removeEventListener('pointerup', this.syncPassageSelection, true);
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.missingDefinitionsOpen()) {
      this.closeMissingDefinitions();
      return;
    }
    if (this.equivalentPromptOpen()) {
      this.closeEquivalentPrompt();
      return;
    }
    if (this.definitionPromptOpen()) {
      this.closeDefinitionPrompt();
      return;
    }
    if (this.examplePromptOpen()) {
      this.closeExamplePrompt();
      return;
    }
    if (this.titleEdit()) {
      if (!this.busy()) this.cancelTitle();
      return;
    }
    if (this.confirm()?.kind === 'exercise') {
      if (!this.busy()) this.confirm.set(null);
      return;
    }
    if (this.exerciseLog() >= 0) {
      if (this.exerciseEntry() >= 0) this.exerciseEntry.set(-1);
      else this.exerciseLog.set(-1);
      return;
    }
    if (this.helpOpen()) {
      this.helpOpen.set(false);
      return;
    }
    if (this.confirm()) {
      this.confirm.set(null);
      return;
    }
    if (this.formAttributesView()) {
      this.formAttributesView.set(null);
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
    if (this.metaEdit()) {
      this.metaEdit.set(null);
      return;
    }
    if (this.editor()) {
      this.closeEditor();
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
    this.colorDraft.set(sanitizeElementColor(this.element().color));
    this.titleEdit.set(true);
  }

  closeTitle(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.busy()) return;
    this.cancelTitle();
  }

  cancelTitle(): void {
    this.titleEdit.set(false);
    this.titleError.set('');
  }

  canSaveElement(): boolean {
    if (this.busy() || !this.editedTitle()) return false;
    return this.titleChanged() || this.colorChanged();
  }

  async saveTitle(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSaveElement()) return;
    const name = this.editedTitle();
    const element = this.element();
    const titleChanged = this.titleChanged();
    if (titleChanged) {
      const taken = this.collection().some(
        (item) => item.id !== element.id && sameTitle(item.title, name),
      );
      if (taken) {
        this.titleError.set('That title is already there.');
        return;
      }
    }
    const current = this.currentElement();
    const definitions = titleChanged
      ? this.copyDefinitions().map((definition) => ({
          ...definition,
          forms: retitleForms(definition.forms, element.title, name),
        }))
      : current.definitions;
    const editing = this.formEdit();
    this.titleError.set('');
    const saved = await this.commit(
      { ...current, title: name, definitions, color: this.chosenColor() },
      { report: false },
    );
    if (!this.alive || this.element().id !== element.id) return;
    if (!saved) {
      this.titleError.set('Could not save this element.');
      return;
    }
    if (editing?.originalText && sameTitle(editing.originalText, element.title)) {
      this.formEdit.set({ ...editing, originalText: name });
      if (sameTitle(this.formDraft(), element.title)) this.formDraft.set(name);
    }
    this.titleEdit.set(false);
  }

  shownTitle(title = this.element().title): string {
    return displayTitle(title, this.element().language);
  }

  /** First letter of a definition, for display. The stored text is unchanged. */
  shownDefinition(text: string): string {
    return displayTitle(text, this.element().language);
  }

  editorEquivalents(): ElementEquivalent[] {
    const language = this.translationTarget();
    if (!language) return [];
    return this.sheetEquivalents().filter((item) => item.language === language);
  }

  removeEquivalent(id: string): void {
    if (this.busy() || this.askingEquivalent()) return;
    const current = this.sheetEquivalents().find((item) => item.id === id);
    if (!current) return;
    this.sheetEquivalents.update((list) => list.filter((item) => item.id !== id));
    if (this.equivalentIdDraft() === id) this.equivalentIdDraft.set(null);
    if (this.equivalentDraft().trim() === current.text) this.equivalentDraft.set('');
  }

  equivalentEntryWidth(): string {
    const length = Math.max((this.equivalentDraft() || 'New equivalent').length, 1);
    return `calc(${length}ch + 1.5rem)`;
  }

  equivalentSelected(id: string): boolean {
    const typed = this.equivalentDraft().trim();
    const language = this.translationTarget();
    if (typed) {
      return this.sheetEquivalents().some(
        (item) => item.id === id && item.language === language && item.text === typed,
      );
    }
    return this.equivalentIdDraft() === id;
  }

  confirmEquivalent(): void {
    const typed = this.equivalentDraft().trim();
    if (!typed || this.busy() || this.askingEquivalent()) return;
    const linked = assignEquivalent(this.sheetEquivalents(), typed, this.translationTarget());
    this.sheetEquivalents.set(linked.equivalents);
    this.equivalentIdDraft.set(linked.equivalentId);
    this.equivalentDraft.set('');
  }

  chooseEquivalent(id: string): void {
    const selected = this.equivalentSelected(id);
    this.equivalentDraft.set('');
    this.equivalentIdDraft.set(selected ? null : id);
  }

  translationLanguageName(): string {
    const code = this.translationTarget();
    return code ? languageDisplayName(code) : '';
  }

  private translationTarget(): string {
    return supportLanguageFor(this.element().language);
  }

  canAskEquivalent(): boolean {
    return (
      this.supportAvailable() &&
      this.draftGloss().length > 0 &&
      !this.translating() &&
      !this.askingEquivalent() &&
      !this.aiBusy()
    );
  }

  async askEquivalent(): Promise<void> {
    if (!this.canAskEquivalent()) return;
    const element = this.element();
    const parsed = parsePassage(this.textDraft());
    const definition = parsed.text.trim();
    const english =
      parsed.translations.find((item) => item.language === this.translationTarget())?.text ?? '';
    const ticket = ++this.equivalentTicket;
    this.askingEquivalent.set(true);
    this.sheetError.set('');
    try {
      const translation = await generateEquivalent({
        lemma: element.title,
        sourceLang: element.language,
        definition,
        english,
        targetLang: this.translationTarget(),
      });
      if (ticket !== this.equivalentTicket) return;
      if (!translation) {
        this.sheetError.set('Could not find an equivalent.');
        return;
      }
      const language = this.translationTarget();
      const folded = translation.toLocaleLowerCase();
      const match = this.sheetEquivalents().find(
        (item) => item.language === language && item.text.toLocaleLowerCase() === folded,
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

  canAskMetadata(): boolean {
    const editor = this.editor();
    return (
      !!editor &&
      this.draftGloss().length > 0 &&
      !this.askingMetadata() &&
      !this.aiBusy() &&
      !this.translating() &&
      !this.askingEquivalent()
    );
  }

  async askMetadata(): Promise<void> {
    const editor = this.editor();
    if (!editor || !this.canAskMetadata()) return;
    const existing = this.metadataToStore();
    this.askingMetadata.set(true);
    this.sheetError.set('');
    try {
      const suggested = await suggestMetadata({
        kind: editor.kind,
        lemma: this.element().title,
        language: this.element().language,
        text: this.draftGloss(),
        existing,
      });
      if (!this.alive || this.editor() !== editor) return;
      this.sheetMetadata.set(mergeMetadata(this.sheetMetadata(), suggested));
    } catch {
      if (!this.alive) return;
      this.sheetError.set('Could not add metadata.');
    } finally {
      this.askingMetadata.set(false);
    }
  }

  canAskFormMetadata(): boolean {
    return (
      !!this.formEdit() &&
      this.formDraft().trim().length > 0 &&
      !this.askingMetadata() &&
      !this.aiBusy()
    );
  }

  async askFormMetadata(): Promise<void> {
    const editing = this.formEdit();
    const text = this.formDraft().trim();
    if (!editing || !this.canAskFormMetadata()) return;
    this.askingMetadata.set(true);
    this.formError.set('');
    try {
      const suggested = await suggestMetadata({
        kind: 'form',
        lemma: this.element().title,
        language: this.element().language,
        text,
        existing: this.formFeaturesToStore(),
      });
      if (!this.alive || this.formEdit() !== editing) return;
      this.formFeatures.set(mergeMetadata(this.formFeatures(), suggested));
    } catch {
      if (!this.alive) return;
      this.formError.set('Could not add metadata.');
    } finally {
      this.askingMetadata.set(false);
    }
  }

  equivalentText(definition: ElementDefinition): string {
    return equivalentTextFor(
      this.element().equivalents,
      definition.equivalentIds,
      this.translationTarget(),
    );
  }

  equivalentUnveiled(text: string): boolean {
    return this.unveiledEquivalents().has(text);
  }

  /** Open the equivalent and the translations together. Only a translation click is logged. */
  unveilSupport(index: number): void {
    this.supportRevealed.set(true);
    const definition = this.shownDefinitions()[index];
    if (!definition) return;
    const equivalent = this.equivalentText(definition);
    if (equivalent) this.unveilEquivalent(equivalent);
  }

  unveilEquivalent(text: string): void {
    const value = text.trim();
    if (!value) return;
    this.unveiledEquivalents.update((current) => {
      if (current.has(value)) return current;
      const next = new Set(current);
      next.add(value);
      return next;
    });
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }

  metaColor(place: MetadataColorPlace, key: string): string | null {
    return readFieldColor(place, key);
  }

  /** Field color, or the next stitch hue when the field has none. */
  /** First colored metadata field on a form, used to tint its chip. */
  formChipColor(form: ElementForm): string | null {
    for (const key of Object.keys(form.metadata)) {
      const color = this.metaColor('forms', key);
      if (color) return color;
    }
    return null;
  }

  sheetMetaColor(kind: Editor['kind'], key: string): string | null {
    return this.metaColor(kind === 'definition' ? 'definitions' : 'examples', key);
  }

  /** First letter of a metadata label, leaving the rest of the wording alone. */
  label(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  workSectionLabel(editor: Editor): string {
    if (editor.kind !== 'definition' || editor.index == null) return 'Definition';
    if (this.workTab() === 'examples') return 'Examples';
    if (this.workTab() === 'forms') return 'Forms';
    return 'Definition';
  }

  workSaveDisabled(): boolean {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return true;
    if (editor.index != null && this.workTab() === 'examples') {
      const draft = this.exampleDraft();
      return (
        this.busy() ||
        this.askingExamples() !== null ||
        draft?.definitionIndex !== editor.index ||
        !draft.text.trim()
      );
    }
    if (editor.index != null && this.workTab() === 'forms') {
      const pending = this.pendingForms();
      return (
        this.busy() ||
        this.askingForms() !== null ||
        pending?.definitionIndex !== editor.index ||
        !pending.forms.length
      );
    }
    return this.busy() || this.translating() || this.askingEquivalent() || !this.draftGloss();
  }

  workCloseDisabled(): boolean {
    return (
      this.busy() ||
      this.definitionSheetBusy() ||
      this.askingExamples() !== null ||
      this.askingForms() !== null
    );
  }

  saveWork(): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition' || this.workSaveDisabled()) return;
    if (editor.index != null && this.workTab() === 'examples') {
      void this.saveExampleDraft();
      return;
    }
    if (editor.index != null && this.workTab() === 'forms') {
      void this.savePendingForms();
      return;
    }
    void this.saveEditor();
  }

  sheetTitle(editor: Editor): string {
    if (editor.kind === 'definition') {
      return editor.index == null ? 'Add a definition' : 'Work';
    }
    return editor.exampleIndex == null ? 'Add an example' : 'Edit example';
  }

  /** Saved definition, including edits that have not reached the parent yet. */
  sheetDefinition(index: number): ElementDefinition | null {
    return this.currentElement().definitions[index] ?? null;
  }

  closeEditor(): void {
    const editor = this.editor();
    if (!editor) return;
    if (
      this.definitionSheetBusy() ||
      this.askingExamples() !== null ||
      this.askingForms() !== null
    ) {
      return;
    }
    if (editor.kind === 'example') {
      this.openDefinition(editor.definitionIndex);
      return;
    }
    this.editor.set(null);
    this.definitionEngineer.set(null);
    this.exampleEngineer.set(null);
    this.exampleDraft.set(null);
    this.pendingForms.set(null);
    this.exampleError.set('');
    this.formsError.set('');
  }

  closeEditorSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.closeEditor();
  }

  showWorkTab(tab: WorkTab): void {
    const editor = this.editor();
    if (tab !== 'definitions' && (editor?.kind !== 'definition' || editor.index == null)) return;
    this.workTab.set(tab);
    this.editorSheet()?.nativeElement.querySelector('.sheet-scroll')?.scrollTo({ top: 0 });
  }

  aiBusy(): boolean {
    return (
      this.busy() ||
      this.asking() ||
      this.addingSelection() ||
      this.askingForms() !== null ||
      this.askingExamples() !== null ||
      this.askingRelated() !== null ||
      this.askingWording() !== null ||
      this.askingGrade() !== null ||
      this.askingEquivalentGrade() !== null ||
      this.askingExampleGrade() !== null ||
      this.askingPolish() !== null
    );
  }

  generateExample(index: number): void {
    if (this.exampleGame(index) || this.aiBusy() || !this.element().definitions[index]) return;
    this.openExampleEngineer(index);
  }

  generateForms(index: number): void {
    if (this.definitionInPlay(index) || this.aiBusy() || !this.sheetDefinition(index)) return;
    void this.askForms(index);
  }

  addFormManually(index: number): void {
    if (this.definitionInPlay(index) || this.aiBusy() || !this.element().definitions[index]) return;
    this.openForm(index);
  }

  onAddExample(index: number): void {
    if (this.exampleCue(index)) {
      this.openExamplePrompt(index);
      return;
    }
    this.addExampleManually(index);
  }

  addExampleManually(index: number): void {
    if (this.definitionInPlay(index) || this.aiBusy()) return;
    this.openExample(index, null);
  }

  submitDefinitionExample(event: Event): void {
    event.preventDefault();
    void this.addDefinitionFromExample();
  }

  addDefinitionManually(): void {
    if (this.asking()) return;
    this.openDefinition(null);
  }

  openMissingDefinitions(): void {
    if (this.aiBusy()) return;
    this.missingSaveError.set('');
    this.missingDefinitionsOpen.set(true);
  }

  closeMissingDefinitions(): void {
    this.missingDefinitionsOpen.set(false);
    this.missingSaveError.set('');
  }

  async addProposedDefinition(sense: GeneratedDefinition): Promise<void> {
    if (this.missingSaving()) return;
    const element = this.element();
    this.missingSaving.set(true);
    this.missingSaveError.set('');
    try {
      const saved = await this.commitGeneratedSenses(element, [sense]);
      if (this.missingDefinitionsOpen() && !saved) {
        this.missingSaveError.set('Could not add that definition.');
      }
    } finally {
      this.missingSaving.set(false);
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
      const placed = await generateDefinitionFromExample({
        language: element.language,
        title,
        example,
        translation: this.translationTarget(),
        existingDefinitions: element.definitions.map((definition) => ({
          text: definition.text,
          metadata: definition.metadata,
        })),
      });
      if (this.element().id !== element.id) return;
      if (!placed) {
        this.error.set('Could not place that example.');
        return;
      }
      if (placed.kind === 'existing') {
        await this.attachExample(element, placed.gloss, example);
        return;
      }
      const seen = new Set(
        element.definitions.map((definition) => definitionGloss(definition.text)),
      );
      const key = definitionGloss(placed.definition.text);
      if (key && seen.has(key)) {
        await this.attachExample(element, key, example);
        return;
      }
      if (!(await this.commitGeneratedSenses(element, [{ ...placed.definition, example }], 'end')))
        return;
      this.definitionExample.set('');
      this.heldExample.set('');
    } catch {
      if (this.element().id === element.id) {
        this.error.set('Could not place that example.');
      }
    } finally {
      if (this.element().id === element.id) this.asking.set(false);
      this.addingDefinitions.set(null);
    }
  }

  private async attachExample(
    element: StoredElement,
    gloss: string,
    example: string,
  ): Promise<void> {
    const definitions = this.copyDefinitions();
    const target = definitions.find(
      (definition) => senseKey(definition.text) === gloss.trim().toLowerCase(),
    );
    if (!target) {
      this.error.set('Could not place that example.');
      return;
    }
    const key = senseKey(example);
    if (!key || target.examples.some((item) => senseKey(item.text) === key)) {
      this.error.set('That example is already there.');
      return;
    }
    target.examples.push({ text: example, metadata: {} });
    this.appendExample(target, example);
    const index = definitions.indexOf(target);
    if (!(await this.persist(definitions, element.equivalents))) return;
    if (this.element().id === element.id) {
      this.definitionPanel.set(index);
      this.scrollDefinitionPanel();
    }
    this.definitionExample.set('');
    this.heldExample.set('');
  }

  dismissNew(text: string): void {
    const glosses = dismissNewDefinition(this.element().id, text);
    this.newGlosses.set(new Set(glosses));
  }

  private refreshNewDefinitions(elementId: string): void {
    const present = new Set(
      this.element()
        .definitions.map((definition) => definitionGloss(definition.text))
        .filter(Boolean),
    );
    this.newGlosses.set(new Set(pruneNewDefinitions(elementId, present)));
  }

  private async adoptStoredSuggestions(elementId: string): Promise<void> {
    const stored = readDefinitionSuggestions(elementId);
    if (!stored.length || this.element().id !== elementId) return;
    const seen = new Set(
      this.element().definitions.map((definition) => definitionGloss(definition.text)),
    );
    const fresh = stored.filter((suggestion) => {
      const gloss = definitionGloss(suggestion.text);
      if (!gloss || seen.has(gloss)) return false;
      seen.add(gloss);
      return true;
    });
    if (!fresh.length) {
      clearDefinitionSuggestions(elementId);
      return;
    }
    if (this.element().id !== elementId) return;
    const saved = await this.commitGeneratedSenses(this.element(), fresh);
    if (saved) clearDefinitionSuggestions(elementId);
  }

  private async commitGeneratedSenses(
    element: StoredElement,
    senses: readonly {
      text: string;
      metadata: ElementMetadata;
      example?: string;
      equivalent?: string;
    }[],
    placement: 'start' | 'end' = 'start',
  ): Promise<boolean> {
    if (!senses.length || this.element().id !== element.id) return false;
    const attached = sensesWithEquivalents(
      this.element().equivalents,
      this.translationTarget(),
      senses,
    );
    const created: ElementDefinition[] = attached.senses.map((sense) => ({
      text: sense.text,
      equivalentIds: sense.equivalentIds,
      forms: [],
      examples: sense.example ? [{ text: sense.example, metadata: {} }] : [],
      metadata: { ...sense.metadata },
      log: [],
    }));
    const existing = this.copyDefinitions();
    this.seatRound(existing.length);
    const next = placement === 'end' ? [...existing, ...created] : [...created, ...existing];
    if (!(await this.persist(next, attached.equivalents))) return false;
    const glosses = created.map((definition) => definitionGloss(definition.text)).filter(Boolean);
    rememberNewDefinitions(element.id, glosses);
    if (this.element().id === element.id) {
      if (placement === 'start') {
        this.noteRoundInsert(0, created.length);
        this.shiftDefinitionIndexes(created.length);
      }
      this.formAttributesView.set(null);
      const index = placement === 'end' ? next.length - 1 : 0;
      this.definitionPanel.set(index);
      this.scrollDefinitionPanel();
      this.noteDefinitionView(index);
      this.newGlosses.set(new Set(readNewDefinitions(element.id)));
    }
    return true;
  }

  private stopSpeech(): void {
    stopSpeaking();
    this.speaking.set(null);
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
    const forms = this.askingForms();
    if (forms != null) this.askingForms.set(forms + by);
    const draft = this.exampleDraft();
    if (draft) this.exampleDraft.set({ ...draft, definitionIndex: draft.definitionIndex + by });
    const pendingForms = this.pendingForms();
    if (pendingForms) {
      this.pendingForms.set({
        ...pendingForms,
        definitionIndex: pendingForms.definitionIndex + by,
      });
    }
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
    this.definitionPanel.set(this.definitionPanel() + by);
  }

  async askForms(index: number): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.currentElement();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    const pending = this.pendingForms();
    const held = pending?.definitionIndex === index ? pending.forms : [];
    this.askingForms.set(index);
    this.formsError.set('');
    try {
      const forms = await generateForms({
        language: element.language,
        title: element.title,
        gloss,
        existingForms: [
          ...definition.forms.map((form) => form.text),
          ...held.map((form) => form.text),
        ],
      });
      if (this.element().id !== element.id) return;
      const current = this.pendingForms();
      const next = current?.definitionIndex === index ? [...current.forms] : [];
      const seen = new Set([
        ...definition.forms.map((form) => form.text.toLowerCase()),
        ...next.map((form) => form.text.toLowerCase()),
      ]);
      for (const form of forms) {
        const key = form.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(form);
      }
      if (next.length === (current?.definitionIndex === index ? current.forms.length : 0)) {
        this.formsError.set('No further forms.');
        return;
      }
      this.pendingForms.set({ definitionIndex: index, forms: next });
    } catch {
      if (this.element().id === element.id) this.formsError.set('Could not ask for forms.');
    } finally {
      if (this.element().id === element.id) this.askingForms.set(null);
    }
  }

  async savePendingForms(): Promise<void> {
    const pending = this.pendingForms();
    if (!pending?.forms.length || this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[pending.definitionIndex];
    if (!definition) return;
    const before = new Set(definition.forms.map((form) => form.text.toLowerCase()));
    for (const form of pending.forms) {
      if (before.has(form.text.toLowerCase())) continue;
      definition.forms.push({ text: form.text, metadata: { ...form.metadata } });
    }
    ensureRootLemma(definition.forms, this.element().title);
    const added = definition.forms
      .filter((form) => !before.has(form.text.toLowerCase()))
      .map((form) => form.text);
    if (!added.length) {
      this.pendingForms.set(null);
      this.closeEditor();
      return;
    }
    this.appendForm(definition, added);
    if (!(await this.persist(definitions, this.currentElement().equivalents))) return;
    if (this.pendingForms() === pending) this.pendingForms.set(null);
    this.closeEditor();
  }

  discardPendingForms(): void {
    if (this.askingForms() !== null) return;
    this.pendingForms.set(null);
    this.formsError.set('');
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

  showFormAttributes(form: ElementForm): void {
    this.formAttributesView.set({ text: form.text, metadata: { ...form.metadata } });
  }

  closeFormAttributes(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.formAttributesView.set(null);
  }

  showDefinition(index: number): void {
    const count = this.shownDefinitions().length;
    if (index < 0 || index >= count || index === this.visibleDefinitionIndex()) return;
    this.unveiledEquivalents.set(new Set());
    this.supportRevealed.set(false);
    this.formAttributesView.set(null);
    this.definitionPanel.set(index);
    this.scrollDefinitionPanel();
    this.noteDefinitionView(index);
  }

  orderDigits(count: number): number {
    return Math.max(1, String(count).length);
  }

  focusOrderInput(event: FocusEvent): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    requestAnimationFrame(() => input.select());
  }

  editOrderInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const digits = input.value.replace(/\D/g, '');
    if (input.value !== digits) input.value = digits;
  }

  commitOrderInput(event: Event, count: number): void {
    if (this.orderSettling) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const current = this.visibleDefinitionIndex() + 1;
    const typed = Number(input.value);
    const next = Number.isInteger(typed) && typed >= 1 && typed <= count ? typed : current;
    input.value = String(next);
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
      this.orderSettling = true;
      input.blur();
      this.orderSettling = false;
    }
    if (next !== current && count > 1) void this.moveDefinition(next - 1);
  }

  cancelOrderInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    event.stopPropagation();
    input.value = String(this.visibleDefinitionIndex() + 1);
    this.orderSettling = true;
    input.blur();
    this.orderSettling = false;
  }

  /** Move the definition on screen to another slot. Order is the array position. */
  private async moveDefinition(to: number): Promise<void> {
    const from = this.visibleDefinitionIndex();
    const elementId = this.currentElement().id;
    if (from === to) return;
    this.seatRound(this.element().definitions.length);
    const definitions = this.copyDefinitions();
    if (to < 0 || to >= definitions.length) return;
    const [moved] = definitions.splice(from, 1);
    if (!moved) return;
    definitions.splice(to, 0, moved);
    if (!(await this.persist(definitions, this.currentElement().equivalents))) return;
    if (this.element().id !== elementId) return;
    this.noteRoundMove(from, to);
    this.definitionPanel.set(to);
  }

  /** Record a view for the definition on screen when this element is opened. */
  private noteOpenedDefinition(id: string): void {
    if (this.viewedElementKey === id) return;
    const element = this.currentElement();
    const index = this.visibleDefinitionIndex();
    if (element.id !== id || !element.definitions[index]) return;
    this.viewedElementKey = id;
    this.noteDefinitionView(index);
  }

  /** Record that this definition is on screen. `at` is the UTC instant. */
  private noteDefinitionView(index: number): void {
    const element = this.currentElement();
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return;
    const gloss = definitionGloss(definition.text);
    const key = `${element.id}:${gloss || index}`;
    if (key === this.viewedDefinitionKey) return;
    this.viewedDefinitionKey = key;
    definition.log = [...definition.log, { event: 'view', at: Date.now() }];
    void this.persist(definitions, element.equivalents, { busy: false });
  }

  private scrollDefinitionPanel(): void {
    this.definitionBody()?.nativeElement.scrollTo({ top: 0 });
  }

  openDefinition(index: number | null): void {
    if (index != null && this.definitionInPlay(index)) return;
    const definition =
      index == null ? null : (this.sheetDefinition(index) ?? this.element().definitions[index]);
    if (index != null && !definition) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.metaKey.set('');
    this.metaValue.set('');
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.exampleError.set('');
    this.formsError.set('');
    if (this.exampleDraft()?.definitionIndex !== index) this.exampleDraft.set(null);
    if (this.pendingForms()?.definitionIndex !== index) this.pendingForms.set(null);
    this.sheetMetadata.set({ ...(definition?.metadata ?? {}) });
    const language = this.translationTarget();
    const equivalentId = language ? (definition?.equivalentIds[language] ?? null) : null;
    const known =
      equivalentId &&
      this.element().equivalents.some(
        (item) => item.id === equivalentId && item.language === language,
      )
        ? equivalentId
        : null;
    this.equivalentIdDraft.set(known);
    this.equivalentDraft.set('');
    this.sheetEquivalents.set(this.element().equivalents.map((item) => ({ ...item })));
    this.beginSheet(definition?.text ?? '');
    if (definition) this.dismissNew(definition.text);
    const previous = this.editor();
    const staying =
      index != null &&
      ((previous?.kind === 'definition' && previous.index === index) ||
        (previous?.kind === 'example' && previous.definitionIndex === index));
    if (!staying) this.workTab.set('definitions');
    this.editor.set({ kind: 'definition', index });
    if (index != null) this.ensureExampleEngineer(index);
  }

  openExample(definitionIndex: number, exampleIndex: number | null): void {
    if (this.definitionInPlay(definitionIndex)) return;
    const definition = this.sheetDefinition(definitionIndex);
    if (!definition) return;
    const example = exampleIndex == null ? null : definition.examples[exampleIndex];
    if (exampleIndex != null && !example) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.metaKey.set('');
    this.metaValue.set('');
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
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
    return this.sheetDefinition(index)?.forms.map((form) => form.text) ?? [];
  }

  private ensureExampleEngineer(index: number): void {
    const definition = this.sheetDefinition(index);
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) {
      this.exampleEngineer.set(null);
      return;
    }
    const draft = this.engineerDrafts.get(key) ?? { instruction: '', forms: [] };
    const available = new Set(definition.forms.map((form) => form.text.toLowerCase()));
    this.exampleEngineer.set({
      definitionIndex: index,
      instruction: draft.instruction,
      forms: draft.forms.filter((form) => available.has(form.toLowerCase())),
      formsOpen: false,
    });
  }

  openExampleEngineer(index: number): void {
    if (this.aiBusy()) return;
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) return;
    this.definitionEngineer.set(null);
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

  definitionEngineerOpen(): boolean {
    const editor = this.editor();
    const engineer = this.definitionEngineer();
    return (
      editor?.kind === 'definition' &&
      editor.index != null &&
      engineer?.definitionIndex === editor.index
    );
  }

  toggleDefinitionEngineer(): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition' || editor.index == null) return;
    if (this.definitionEngineerOpen()) {
      this.closeDefinitionEngineer();
      return;
    }
    if (this.aiBusy()) return;
    const definition = this.element().definitions[editor.index];
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) return;
    const draft = this.definitionEngineerDrafts.get(key) ?? {
      instruction: '',
      words: [],
      selected: [],
    };
    const known = new Set(draft.words.map((word) => word.text.toLowerCase()));
    this.sheetError.set('');
    this.definitionEngineer.set({
      definitionIndex: editor.index,
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

  private appendedEngineerPassage(extra: ReturnType<typeof parsePassage>): string {
    const current = readEditingDraft(this.textDraft());
    this.captureEditingDraft(this.textDraft(), this.translationTarget());
    const target = this.translationTarget();
    const addition = extra.translations.find((item) => item.language === target)?.text ?? '';
    if (target) {
      const next = addition ? joinPhrase(current.translation, addition) : current.translation;
      if (next) this.editingTranslations.set(target, next);
      else this.editingTranslations.delete(target);
    }
    for (const item of extra.translations) {
      if (!item.language || item.language === target || !item.text) continue;
      const existing = this.editingTranslations.get(item.language) ?? '';
      this.editingTranslations.set(
        item.language,
        existing ? joinPhrase(existing, item.text) : item.text,
      );
    }
    return this.storedFromTranslations(joinPhrase(current.text, extra.text));
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
    const gloss = this.draftGloss();
    const sense = senseKey(definition?.text ?? '');
    if (!definition || !gloss || !sense) return;
    const job = ++this.relatedJob;
    const index = engineer.definitionIndex;
    this.askingRelated.set(index);
    this.sheetError.set('');
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
        this.sheetError.set('No further related words.');
        return;
      }
      this.patchDefinitionEngineer({ words: [...current.words, ...added] });
    } catch {
      if (this.element().id === element.id) this.sheetError.set('Could not ask for related words.');
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
    const gloss = this.draftGloss();
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
    this.sheetError.set('');
    try {
      const phrases = await verbalizeDefinition({
        language: element.language,
        title: element.title,
        gloss,
        words: picked,
        definitionInstruction: engineer.instruction,
        translation: this.translationTarget(),
      });
      const phrase = phrases[0];
      const showing = this.element().id === element.id;
      if (!phrase) {
        if (showing) this.sheetError.set('Could not forge a definition.');
        return;
      }
      const extra = parsePassage(phrase.text);
      if (!extra.text) {
        if (showing) this.sheetError.set('Could not forge a definition.');
        return;
      }
      if (picked.some((word) => !sentenceUsesForm(extra.text, word.text))) {
        if (showing) this.sheetError.set('The phrase did not use every chosen word.');
        return;
      }
      if (!showing) return;
      if (sense && senseKey(this.element().definitions[index]?.text ?? '') !== sense) return;
      const stored = this.appendedEngineerPassage(extra);
      this.seedEditingTranslations(stored);
      this.textDraft.set(passageForEditing(stored, this.translationTarget()));
    } catch {
      if (this.element().id === element.id) this.sheetError.set('Could not forge a definition.');
    } finally {
      if (this.wordingJob === job && this.element().id === element.id) this.askingWording.set(null);
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
    const element = this.currentElement();
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
    const held = this.exampleDraftFor(engineer.definitionIndex);
    const job = ++this.exampleJob;
    const index = engineer.definitionIndex;
    this.askingExamples.set(index);
    this.exampleError.set('');
    try {
      const examples = await generateExamples({
        language: element.language,
        title: element.title,
        gloss,
        translation: this.translationTarget(),
        metadata: definition.metadata,
        existingExamples: [
          ...definition.examples.map((example) => parsePassage(example.text).text),
          ...(held ? [parsePassage(held.text).text] : []),
        ],
        forms: required ? [] : definition.forms.map((form) => form.text),
        exampleWords: [],
        exampleInstruction: engineer.instruction,
        ...(required ? { requiredForm: required } : {}),
      });
      const sentence = examples[0];
      const showing = this.element().id === element.id;
      if (!sentence) {
        if (showing) this.exampleError.set('No further examples.');
        return;
      }
      const primary = parsePassage(sentence.text).text;
      if (required && !sentenceUsesForm(primary, required)) {
        if (showing) this.exampleError.set('The example did not use the chosen form.');
        return;
      }
      if (!showing) return;
      const target = this.currentElement().definitions.find(
        (item) => senseKey(item.text) === sense,
      );
      if (!target) return;
      const sentenceKey = senseKey(sentence.text);
      if (
        !sentenceKey ||
        target.examples.some((example) => senseKey(example.text) === sentenceKey) ||
        (held && senseKey(held.text) === sentenceKey)
      ) {
        this.exampleError.set('No further examples.');
        return;
      }
      this.exampleDraft.set({
        definitionIndex: index,
        text: sentence.text,
        metadata: { ...sentence.metadata },
      });
    } catch {
      if (this.element().id === element.id) this.exampleError.set('Could not ask for examples.');
    } finally {
      if (this.exampleJob === job && this.element().id === element.id)
        this.askingExamples.set(null);
    }
  }

  exampleDraftFor(index: number): ExampleDraft | null {
    const draft = this.exampleDraft();
    return draft?.definitionIndex === index ? draft : null;
  }

  pendingFormsFor(index: number): ElementForm[] {
    const pending = this.pendingForms();
    return pending?.definitionIndex === index ? pending.forms : [];
  }

  async saveExampleDraft(): Promise<void> {
    const draft = this.exampleDraft();
    if (!draft || this.busy()) return;
    const definitions = this.copyDefinitions();
    const target = definitions[draft.definitionIndex];
    if (!target) return;
    const key = senseKey(draft.text);
    if (!key || target.examples.some((example) => senseKey(example.text) === key)) {
      this.exampleError.set('That example is already there.');
      return;
    }
    target.examples.push({ text: draft.text, metadata: { ...draft.metadata } });
    this.appendExample(target, draft.text);
    this.exampleError.set('');
    if (!(await this.persist(definitions, this.currentElement().equivalents))) return;
    if (senseKey(this.exampleDraft()?.text ?? '') === key) this.exampleDraft.set(null);
    this.closeEditor();
  }

  discardExampleDraft(): void {
    if (this.askingExamples() !== null) return;
    this.exampleDraft.set(null);
    this.exampleError.set('');
  }

  openExistingForm(definitionIndex: number, text: string): void {
    if (this.definitionInPlay(definitionIndex) || this.busy()) return;
    const form = this.sheetDefinition(definitionIndex)?.forms.find((item) => item.text === text);
    if (!form) return;
    this.openForm(definitionIndex, form);
  }

  closeFormSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget || this.busy()) return;
    this.cancelForm();
  }

  openForm(definitionIndex: number, form?: { text: string; metadata: ElementMetadata }): void {
    if (!this.sheetDefinition(definitionIndex)) return;
    this.confirm.set(null);
    this.metaEdit.set(null);
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formFeatureKey.set('');
    this.formFeatureValue.set('');
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
    this.formFeatureKey.set('');
    this.formFeatureValue.set('');
  }

  private formFeaturesToStore(): ElementMetadata {
    const editing = this.formFeatureEdit();
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (key && value) {
      return writeMetadata(this.formFeatures(), editing?.previousKey ?? null, key, value);
    }
    return { ...this.formFeatures() };
  }

  commitNewFormFeature(): void {
    if (this.formFeatureEdit() || this.busy()) return;
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!key || !value) return;
    this.formFeatures.set(writeMetadata(this.formFeatures(), null, key, value));
    this.formFeatureKey.set('');
    this.formFeatureValue.set('');
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
    this.metaKey.set('');
    this.metaValue.set('');
  }

  highlightPassage(text: string): DefinitionHighlightPart[] {
    const element = this.element();
    const shown = displayTitle(text, element.language);
    const others: HighlightSource[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      others.push({
        id: item.id,
        title: item.title,
        forms: elementFormTexts(item),
        ...scoreColor(item),
      });
    }
    return highlightDefinitionPassage(
      shown,
      {
        id: element.id,
        title: element.title,
        forms: elementFormTexts(element),
        ...scoreColor(element),
      },
      others,
    );
  }

  openHelp(): void {
    if (this.busy() || !this.inPlay()) return;
    this.helpOpen.set(true);
  }

  closeHelp(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.helpOpen.set(false);
  }

  /**
   * Stop this round. Every exercise still waiting scores 0, then the card is shown.
   * A score already saved in this round stays.
   */
  async giveUpGame(): Promise<void> {
    if (!this.inPlay() || this.aiBusy() || this.concedingGame) return;
    const mode = this.playMode();
    if (mode !== 1 && mode !== 2 && mode !== 3) {
      this.finishGiveUp();
      return;
    }
    const definitions = this.copyDefinitions();
    const indexes = this.unscoredExerciseIndexes(mode, definitions);
    if (!indexes.length) {
      this.finishGiveUp();
      return;
    }
    this.concedingGame = true;
    const elementId = this.element().id;
    try {
      const logged = this.appendGiveUpLogs(mode, definitions, indexes);
      const saved = await this.persist(logged.definitions, this.element().equivalents);
      if (!this.alive || this.element().id !== elementId) return;
      if (!saved) {
        this.error.set('Could not save this score.');
        if (mode === 1) this.equivalentGradeError.set('Could not save this score.');
        this.helpOpen.set(false);
        return;
      }
      this.writeGiveUpRound(mode, indexes, logged.logIndexes);
      this.finishGiveUp();
    } finally {
      this.concedingGame = false;
    }
  }

  /** Definitions this game still asks for. */
  private unscoredExerciseIndexes(mode: ElementMode, definitions: ElementDefinition[]): number[] {
    const indexes: number[] = [];
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      if (!definition || !this.exercisePending(mode, index, definition)) continue;
      indexes.push(index);
    }
    return indexes;
  }

  private exercisePending(
    mode: ElementMode,
    index: number,
    definition: ElementDefinition,
  ): boolean {
    if (!this.inThisRound(index)) return false;
    if (mode === 1) return !!this.equivalentText(definition) && !this.equivalentRewardAt(index);
    if (mode === 2) {
      return parsePassage(definition.text).text.trim().length > 0 && !this.exampleRewardAt(index);
    }
    return !this.definitionRewardAt(index);
  }

  /** A definition is in this exercise when it was on the card as play started. */
  private inThisRound(index: number): boolean {
    if (!this.playing()) return false;
    const included = this.round().included;
    if (included == null) return true;
    return included[index] === true;
  }

  /** Remember who is playing before the definition list changes. */
  private seatRound(count: number): void {
    if (!this.playing() || this.round().included != null) return;
    this.writeRound({
      ...this.round(),
      included: Array.from({ length: count }, () => true),
    });
  }

  private noteRoundInsert(index: number, count: number): void {
    if (count <= 0) return;
    this.retargetPlayIndexes((current) => (current >= index ? current + count : current));
    if (this.round().included == null) return;
    this.writeRound(insertRoundSlots(this.round(), index, count));
  }

  private noteRoundRemove(index: number): void {
    this.retargetPlayIndexes((current) => {
      if (current === index) return -1;
      return current > index ? current - 1 : current;
    });
    if (this.round().included == null) return;
    this.writeRound(removeRoundSlot(this.round(), index));
  }

  private noteRoundMove(from: number, to: number): void {
    if (from === to) return;
    this.retargetPlayIndexes((current) => {
      if (current === from) return to;
      if (from < to && current > from && current <= to) return current - 1;
      if (to < from && current >= to && current < from) return current + 1;
      return current;
    });
    if (this.round().included == null) return;
    this.writeRound(moveRoundSlot(this.round(), from, to));
  }

  /** Nothing in this round is left to score. */
  private clearRoundSlots(): void {
    const playing = this.playing();
    this.writeRound({
      ...emptyPlayRound(),
      givenUp: playing && this.round().givenUp,
      included: playing ? [] : null,
    });
    this.equivalentPrompt.set(-1);
    this.definitionPrompt.set(-1);
    this.examplePrompt.set(-1);
    this.exerciseLog.set(-1);
  }

  /** Keep an open sheet on the same definition after the list changes. */
  private retargetPlayIndexes(map: (current: number) => number): void {
    this.equivalentPrompt.update(map);
    this.definitionPrompt.update(map);
    this.examplePrompt.update(map);
    this.exerciseLog.update(map);
  }

  /** Append a 0 for each pending exercise. `logIndexes` lines up with `indexes`. */
  private appendGiveUpLogs(
    mode: ElementMode,
    definitions: ElementDefinition[],
    indexes: readonly number[],
  ): { definitions: ElementDefinition[]; logIndexes: number[] } {
    const game: DefinitionGameLog['game'] =
      mode === 2 ? 'example' : mode === 3 ? 'definition' : 'translation';
    const at = Date.now();
    const next = definitions.slice();
    const logIndexes: number[] = [];
    for (const index of indexes) {
      const definition = next[index];
      if (!definition) {
        logIndexes.push(-1);
        continue;
      }
      const log = definition.log.map((item) => ({ ...item }));
      const stored: DefinitionGameLog = {
        event: 'game',
        game,
        score: 0,
        by: 'user',
        at,
        answer: '',
      };
      let logIndex = this.giveUpLogIndex(mode, index);
      const current = typeof logIndex === 'number' ? log[logIndex] : undefined;
      const savedGame = this.withSnapshot(definition, current, stored);
      if (current?.event === 'game' && typeof logIndex === 'number') {
        log[logIndex] = savedGame;
      } else {
        log.push(savedGame);
        logIndex = log.length - 1;
      }
      next[index] = { ...definition, log };
      logIndexes.push(logIndex);
    }
    return { definitions: next, logIndexes };
  }

  private giveUpLogIndex(mode: ElementMode, index: number): number | null | undefined {
    const round = this.round();
    if (mode === 1) return round.equivalentLogIndexes[index];
    if (mode === 2) return round.exampleLogIndexes?.[index];
    return round.definitionLogIndexes?.[index];
  }

  private writeGiveUpRound(
    mode: ElementMode,
    indexes: readonly number[],
    logIndexes: readonly number[],
  ): void {
    const round = this.round();
    if (mode === 1) {
      const equivalentDrafts = round.equivalentDrafts.slice();
      const equivalentSubmitted = round.equivalentSubmitted.slice();
      const equivalentRewards = round.equivalentRewards.slice();
      const equivalentLogIndexes = round.equivalentLogIndexes.slice();
      for (let position = 0; position < indexes.length; position += 1) {
        const index = indexes[position];
        const logIndex = logIndexes[position];
        if (index == null || logIndex == null || logIndex < 0) continue;
        while (equivalentDrafts.length <= index) equivalentDrafts.push('');
        while (equivalentSubmitted.length <= index) equivalentSubmitted.push(false);
        while (equivalentRewards.length <= index) equivalentRewards.push(null);
        while (equivalentLogIndexes.length <= index) equivalentLogIndexes.push(null);
        equivalentDrafts[index] = '';
        equivalentSubmitted[index] = true;
        equivalentRewards[index] = { score: 0, by: 'user', explanation: '' };
        equivalentLogIndexes[index] = logIndex;
      }
      this.writeRound({
        ...round,
        equivalentDrafts,
        equivalentSubmitted,
        equivalentRewards,
        equivalentLogIndexes,
        givenUp: true,
      });
      return;
    }
    if (mode === 2) {
      const exampleDrafts = round.exampleDrafts?.slice() ?? [];
      const exampleSubmitted = round.exampleSubmitted?.slice() ?? [];
      const exampleRewards = round.exampleRewards?.slice() ?? [];
      const exampleLogIndexes = round.exampleLogIndexes?.slice() ?? [];
      for (let position = 0; position < indexes.length; position += 1) {
        const index = indexes[position];
        const logIndex = logIndexes[position];
        if (index == null || logIndex == null || logIndex < 0) continue;
        while (exampleDrafts.length <= index) exampleDrafts.push('');
        while (exampleSubmitted.length <= index) exampleSubmitted.push(false);
        while (exampleRewards.length <= index) exampleRewards.push(null);
        while (exampleLogIndexes.length <= index) exampleLogIndexes.push(null);
        exampleDrafts[index] = '';
        exampleSubmitted[index] = true;
        exampleRewards[index] = { score: 0, by: 'user', explanation: '' };
        exampleLogIndexes[index] = logIndex;
      }
      this.writeRound({
        ...round,
        exampleDrafts,
        exampleSubmitted,
        exampleRewards,
        exampleLogIndexes,
        givenUp: true,
      });
      return;
    }
    const definitionDrafts = round.definitionDrafts.slice();
    const definitionSubmitted = round.definitionSubmitted?.slice() ?? [];
    const definitionRewards = round.definitionRewards?.slice() ?? [];
    const definitionLogIndexes = round.definitionLogIndexes?.slice() ?? [];
    for (let position = 0; position < indexes.length; position += 1) {
      const index = indexes[position];
      const logIndex = logIndexes[position];
      if (index == null || logIndex == null || logIndex < 0) continue;
      while (definitionDrafts.length <= index) definitionDrafts.push('');
      while (definitionSubmitted.length <= index) definitionSubmitted.push(false);
      while (definitionRewards.length <= index) definitionRewards.push(null);
      while (definitionLogIndexes.length <= index) definitionLogIndexes.push(null);
      definitionDrafts[index] = '';
      definitionSubmitted[index] = true;
      definitionRewards[index] = { score: 0, by: 'user', explanation: '' };
      definitionLogIndexes[index] = logIndex;
    }
    this.writeRound({
      ...round,
      definitionDrafts,
      definitionSubmitted,
      definitionRewards,
      definitionLogIndexes,
      givenUp: true,
    });
  }

  private finishGiveUp(): void {
    this.equivalentPrompt.set(-1);
    this.definitionPrompt.set(-1);
    this.examplePrompt.set(-1);
    this.helpOpen.set(false);
    if (!this.round().givenUp) this.writeRound({ ...this.round(), givenUp: true });
  }

  private editedTitle(): string {
    return this.titleDraft().replace(/\s+/g, ' ').trim().slice(0, FORM_MAX_LENGTH);
  }

  private titleChanged(): boolean {
    return this.editedTitle() !== this.element().title;
  }

  private chosenColor(): string | null {
    return sanitizeElementColor(this.colorDraft());
  }

  private colorChanged(): boolean {
    return this.chosenColor() !== sanitizeElementColor(this.element().color);
  }

  showCollision(
    event: MouseEvent,
    matches: DefinitionHighlightMatch[],
    definition: number,
    example = '',
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.collisionDefinition = definition;
    this.collisionExample = example.trim();
    this.collision.set(matches);
  }

  visitCollision(id: string): void {
    this.visitHighlight(id, this.collisionDefinition, this.collisionExample);
  }

  visitHighlight(id: string, definition = this.collisionDefinition, example = ''): void {
    this.collision.set(null);
    this.collisionExample = '';
    if (!id || id === this.element().id) return;
    this.visit.emit({ id, definition, example: example.trim() });
  }

  passagePick(definitionIndex: number, exampleIndex: number | null): PassageSelection | null {
    const pick = this.passageSelection();
    if (!pick || pick.definitionIndex !== definitionIndex || pick.exampleIndex !== exampleIndex) {
      return null;
    }
    return pick;
  }

  private passageExample(pick: PassageSelection | null): string {
    if (!pick || pick.exampleIndex == null) return '';
    const definition = this.element().definitions[pick.definitionIndex];
    return parsePassage(definition?.examples[pick.exampleIndex]?.text ?? '').text.trim();
  }

  confirmPassagePick(event: Event, text: string, ai = false): void {
    event.preventDefault();
    event.stopPropagation();
    const title = text.replace(/\s+/g, ' ').trim();
    if (!title || this.aiBusy()) return;
    if (ai) this.addingSelection.set(true);
    this.blockPassageSelectionUntil = Date.now() + 400;
    window.getSelection()?.removeAllRanges();
    const pick = this.passageSelection();
    const definition = pick?.definitionIndex ?? this.visibleDefinitionIndex();
    if (!ai) {
      this.passageSelection.set(null);
      this.addSelection.emit({
        title,
        language: this.element().language,
        definition,
        example: this.passageExample(pick),
      });
      return;
    }
    void this.askSelectionElement(title, pick);
  }

  private async askSelectionElement(title: string, pick: PassageSelection | null): Promise<void> {
    const element = this.element();
    const definition = pick ? element.definitions[pick.definitionIndex] : undefined;
    const source =
      pick?.exampleIndex == null ? definition?.text : definition?.examples[pick.exampleIndex]?.text;
    const context = parsePassage(source ?? '').text;
    const example = pick?.exampleIndex == null ? '' : context;
    this.addingSelection.set(true);
    this.error.set('');
    try {
      const generated = await generateElementFromSelection({
        language: element.language,
        selected: title,
        context,
        translation: this.translationTarget(),
      });
      if (this.element().id !== element.id) return;
      if (!generated) {
        this.error.set('Could not add that element.');
        return;
      }
      this.passageSelection.set(null);
      this.addPrepared.emit({
        title: generated.lemma,
        language: element.language,
        example,
        definition: pick?.definitionIndex ?? this.visibleDefinitionIndex(),
        definitions: generated.definitions.map((sense) => ({
          text: sense.text,
          equivalent: sense.equivalent,
          equivalentIds: {},
          forms: selectionForms(generated.lemma, title),
          examples: [],
          metadata: { ...sense.metadata },
          log: [],
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
    const pick = readPassageSelection();
    if (pick?.exampleIndex != null && this.exampleGame(pick.definitionIndex)) {
      window.getSelection()?.removeAllRanges();
      this.passageSelection.set(null);
      return;
    }
    this.passageSelection.set(pick);
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

  draftGloss(): string {
    return readEditingDraft(this.textDraft()).text.trim();
  }

  canTranslate(): boolean {
    return (
      this.supportAvailable() &&
      this.draftGloss().length > 0 &&
      !this.translating() &&
      !this.askingEquivalent() &&
      !this.busy()
    );
  }

  async translateDraft(): Promise<void> {
    if (!this.canTranslate()) return;
    const text = this.draftGloss();
    const source = this.element().language;
    const ticket = this.translateTicket;
    this.translating.set(true);
    this.sheetError.set('');
    try {
      const translated = await translatePhrase(text, source, this.translationTarget());
      if (ticket !== this.translateTicket) return;
      this.writeTranslation(this.translationTarget(), translated);
    } catch {
      if (ticket !== this.translateTicket) return;
      this.sheetError.set('Could not translate this.');
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  async saveEditor(): Promise<void> {
    const editor = this.editor();
    const primary = this.draftGloss();
    if (!editor || !primary || this.busy() || this.translating() || this.askingEquivalent()) return;
    const text = this.phraseToStore();
    const definitions = this.copyDefinitions();
    if (editor.kind === 'definition') {
      const current = editor.index == null ? null : definitions[editor.index];
      if (editor.index != null && !current) return;
      const language = this.translationTarget();
      const typed = language ? this.equivalentDraft().trim() : '';
      const selectedId = language ? this.equivalentIdDraft() : null;
      const linked = typed
        ? assignEquivalent(this.sheetEquivalents(), typed, language)
        : {
            equivalents: this.sheetEquivalents(),
            equivalentId:
              selectedId &&
              this.sheetEquivalents().some(
                (item) => item.id === selectedId && item.language === language,
              )
                ? selectedId
                : null,
          };
      const kept = new Set(linked.equivalents.map((item) => item.id));
      const unlinked = definitions.map((definition) => ({
        ...definition,
        equivalentIds: pruneEquivalentLinks(definition.equivalentIds, kept),
      }));
      const previous = pruneEquivalentLinks(current?.equivalentIds ?? {}, kept);
      const equivalentIds = language
        ? linkEquivalent(previous, language, linked.equivalentId)
        : previous;
      const equivalent = linked.equivalentId
        ? (linked.equivalents.find((item) => item.id === linked.equivalentId)?.text ?? '')
        : '';
      const next: ElementDefinition = {
        text,
        equivalentIds,
        forms: current?.forms ?? [],
        examples: current?.examples ?? [],
        metadata: this.metadataToStore(),
        log: this.logWithRework(current, text, equivalent, this.metadataToStore()),
      };
      if (editor.index == null) {
        this.seatRound(definitions.length);
        unlinked.push(next);
      } else unlinked[editor.index] = next;
      const index = editor.index ?? unlinked.length - 1;
      if (await this.persist(unlinked, linked.equivalents)) {
        if (editor.index == null) {
          this.definitionPanel.set(index);
          this.scrollDefinitionPanel();
        }
        this.closeEditor();
      }
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
    const exampleIndex = editor.exampleIndex;
    if (exampleIndex == null) {
      definition.examples.push(next);
      this.appendExample(definition, text);
    } else definition.examples[exampleIndex] = next;
    const definitionIndex = editor.definitionIndex;
    if (await this.persist(definitions, this.element().equivalents)) {
      this.openDefinition(definitionIndex);
    }
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
    const before = new Set(definition.forms.map((item) => item.text.toLowerCase()));
    if (original == null) definition.forms.push(next);
    else {
      const index = definition.forms.findIndex((item) => item.text === original);
      if (index < 0) return;
      definition.forms[index] = next;
    }
    ensureRootLemma(definition.forms, this.element().title);
    if (original == null) {
      const added = definition.forms
        .filter((item) => !before.has(item.text.toLowerCase()))
        .map((item) => item.text);
      if (added.length) this.appendForm(definition, added);
    }
    if (await this.persist(definitions, this.element().equivalents)) this.cancelForm();
  }

  private metadataToStore(): ElementMetadata {
    const editing = this.metaEdit();
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (key && value)
      return writeMetadata(this.sheetMetadata(), editing?.previousKey ?? null, key, value);
    return { ...this.sheetMetadata() };
  }

  metaEntryWidth(value: string, placeholder: string): string {
    const length = Math.max((value || placeholder).length, 1);
    return `calc(${length}ch + 0.9rem)`;
  }

  commitNewMetadata(): void {
    if (this.metaEdit() || this.busy()) return;
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!key || !value) return;
    this.sheetMetadata.set(writeMetadata(this.sheetMetadata(), null, key, value));
    this.metaKey.set('');
    this.metaValue.set('');
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
    if (this.definitionInPlay(definitionIndex) || this.busy()) return;
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
    if (pending.kind === 'definitions') return 'Delete all definitions?';
    if (pending.kind === 'exercise') {
      const definition = this.element().definitions[pending.definitionIndex];
      const entry = definition
        ? this.definitionHistory(definition)[pending.historyIndex]
        : undefined;
      if (entry?.event === 'rework') return 'Delete this rework?';
      if (entry?.event === 'example') return 'Delete this example?';
      if (entry?.event === 'form') return 'Delete these forms?';
      if (entry?.event === 'view') return 'Delete this seen event?';
      if (entry?.event === 'reveal') return 'Delete this revealed event?';
      return 'Delete this exercise?';
    }
    return 'Delete this example?';
  }

  deleteLabel(): string {
    return this.element().definitions.length ? 'Delete definition' : 'Delete element';
  }

  deleteTitle(): string {
    return this.element().definitions.length
      ? 'Delete definition. Hold to delete all.'
      : 'Delete element';
  }

  startDeletePress(event: PointerEvent): void {
    if (event.button !== 0 || !this.element().definitions.length) return;
    if (this.definitionInPlay(this.visibleDefinitionIndex()) || this.busy() || this.aiBusy())
      return;
    this.endDeletePress();
    this.deletePressX = event.clientX;
    this.deletePressY = event.clientY;
    this.deletePressTimer = window.setTimeout(() => {
      this.deletePressTimer = 0;
      this.deletePressHeld = true;
      this.askDeleteAllDefinitions();
    }, DELETE_PRESS_MS);
  }

  moveDeletePress(event: PointerEvent): void {
    if (!this.deletePressTimer) return;
    const dx = event.clientX - this.deletePressX;
    const dy = event.clientY - this.deletePressY;
    if (dx * dx + dy * dy > 100) this.endDeletePress();
  }

  endDeletePress(): void {
    window.clearTimeout(this.deletePressTimer);
    this.deletePressTimer = 0;
  }

  onDeleteClick(): void {
    if (this.deletePressHeld) {
      this.deletePressHeld = false;
      return;
    }
    if (!this.element().definitions.length) {
      this.askDeleteElement();
      return;
    }
    this.askDeleteDefinition(this.visibleDefinitionIndex());
  }

  askDeleteElement(): void {
    if (this.busy()) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.confirm.set({ kind: 'element' });
  }

  askDeleteDefinition(index: number): void {
    if (this.definitionInPlay(index) || this.aiBusy() || this.busy()) return;
    if (!this.element().definitions[index]) return;
    this.confirm.set({ kind: 'definition', index });
  }

  askDeleteAllDefinitions(): void {
    if (this.aiBusy() || this.busy()) return;
    if (!this.element().definitions.length) return;
    this.confirm.set({ kind: 'definitions' });
  }

  askDeleteExample(definitionIndex: number, exampleIndex: number): void {
    if (this.definitionInPlay(definitionIndex) || this.aiBusy() || this.busy()) return;
    this.confirm.set({ kind: 'example', definitionIndex, exampleIndex });
  }

  askDeleteExercise(definitionIndex: number, historyIndex: number): void {
    if (this.busy() || historyIndex < 0) return;
    const entry = this.definitionHistory(this.element().definitions[definitionIndex])[historyIndex];
    if (!entry) return;
    this.confirm.set({ kind: 'exercise', definitionIndex, historyIndex });
  }

  async confirmDelete(): Promise<void> {
    const pending = this.confirm();
    if (!pending || this.busy()) return;
    if (pending.kind === 'element') {
      await this.removeElement();
      return;
    }
    if (pending.kind === 'exercise') {
      await this.removeExercise(pending.definitionIndex, pending.historyIndex);
      return;
    }
    if (pending.kind === 'definitions') {
      await this.removeAllDefinitions();
      return;
    }
    if (pending.kind === 'definition') this.seatRound(this.element().definitions.length);
    const definitions = this.copyDefinitions();
    const archived = pending.kind === 'definition' ? definitions[pending.index] : undefined;
    const removed = archived ? senseKey(archived.text) : '';
    if (pending.kind === 'definition') {
      if (!archived) {
        this.confirm.set(null);
        return;
      }
      definitions.splice(pending.index, 1);
    } else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
    if (
      !(await this.persist(definitions, this.element().equivalents, {
        removedDefinitions: archived
          ? [...this.copyRemovedDefinitions(), { ...archived, deletedAt: Date.now() }]
          : undefined,
      }))
    )
      return;
    if (pending.kind === 'definition') {
      this.noteRoundRemove(pending.index);
      if (removed && !definitions.some((definition) => senseKey(definition.text) === removed)) {
        this.engineerDrafts.delete(removed);
        this.definitionEngineerDrafts.delete(removed);
        writeRelatedDrafts(this.element().id, this.definitionEngineerDrafts);
        this.replaceExampleSuggestions(this.element().id, removed, []);
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
      const forms = this.askingForms();
      if (forms === pending.index) this.askingForms.set(null);
      else if (forms != null && forms > pending.index) this.askingForms.set(forms - 1);
      const exampleDraft = this.exampleDraft();
      if (exampleDraft?.definitionIndex === pending.index) this.exampleDraft.set(null);
      else if (exampleDraft && exampleDraft.definitionIndex > pending.index) {
        this.exampleDraft.set({
          ...exampleDraft,
          definitionIndex: exampleDraft.definitionIndex - 1,
        });
      }
      const pendingForms = this.pendingForms();
      if (pendingForms?.definitionIndex === pending.index) this.pendingForms.set(null);
      else if (pendingForms && pendingForms.definitionIndex > pending.index) {
        this.pendingForms.set({
          ...pendingForms,
          definitionIndex: pendingForms.definitionIndex - 1,
        });
      }
      const related = this.askingRelated();
      if (related === pending.index) this.askingRelated.set(null);
      else if (related != null && related > pending.index) this.askingRelated.set(related - 1);
      const wording = this.askingWording();
      if (wording === pending.index) this.askingWording.set(null);
      else if (wording != null && wording > pending.index) this.askingWording.set(wording - 1);
      const panel = this.definitionPanel();
      const removedVisible = panel === pending.index || panel >= definitions.length;
      if (panel > pending.index) this.definitionPanel.set(panel - 1);
      else if (panel >= definitions.length) {
        this.definitionPanel.set(Math.max(0, definitions.length - 1));
      }
      if (removedVisible) this.scrollDefinitionPanel();
    }
    this.confirm.set(null);
    if (pending.kind === 'definition') this.editor.set(null);
    else this.adjustExampleEditor(pending.definitionIndex, pending.exampleIndex);
  }

  private async removeAllDefinitions(): Promise<void> {
    const definitions = this.copyDefinitions();
    const removed = definitions.map((definition) => senseKey(definition.text)).filter(Boolean);
    const removedDefinitions = [
      ...this.copyRemovedDefinitions(),
      ...definitions.map((definition) => ({ ...definition, deletedAt: Date.now() })),
    ];
    if (!(await this.persist([], this.element().equivalents, { removedDefinitions }))) return;
    this.clearRoundSlots();
    for (const key of removed) {
      this.engineerDrafts.delete(key);
      this.definitionEngineerDrafts.delete(key);
      this.replaceExampleSuggestions(this.element().id, key, []);
    }
    writeRelatedDrafts(this.element().id, this.definitionEngineerDrafts);
    this.exampleEngineer.set(null);
    this.definitionEngineer.set(null);
    this.askingExamples.set(null);
    this.askingForms.set(null);
    this.exampleDraft.set(null);
    this.pendingForms.set(null);
    this.askingRelated.set(null);
    this.askingWording.set(null);
    this.editor.set(null);
    this.formEdit.set(null);
    this.formAttributesView.set(null);
    this.definitionPanel.set(0);
    this.scrollDefinitionPanel();
    this.confirm.set(null);
  }

  private adjustExampleEditor(definitionIndex: number, exampleIndex: number): void {
    const editor = this.editor();
    if (editor?.kind !== 'example' || editor.definitionIndex !== definitionIndex) return;
    if (editor.exampleIndex === exampleIndex) this.editor.set(null);
    else if (editor.exampleIndex != null && editor.exampleIndex > exampleIndex) {
      this.editor.set({ ...editor, exampleIndex: editor.exampleIndex - 1 });
    }
  }

  private async removeExercise(definitionIndex: number, historyIndex: number): Promise<void> {
    const elementId = this.element().id;
    const definition = this.currentElement().definitions[definitionIndex];
    const entry = definition ? this.definitionHistory(definition)[historyIndex] : undefined;
    const logIndex = definition && entry ? definition.log.indexOf(entry) : -1;
    if (!definition || logIndex < 0) {
      this.confirm.set(null);
      return;
    }
    const definitions = this.copyDefinitions();
    const next = definitions[definitionIndex];
    if (!next) {
      this.confirm.set(null);
      return;
    }
    next.log = next.log.filter((_, index) => index !== logIndex);
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    if (!this.alive || this.element().id !== elementId) {
      this.confirm.set(null);
      return;
    }
    this.adjustExerciseRound(definitionIndex, logIndex);
    this.confirm.set(null);
    this.exerciseEntry.set(-1);
  }

  /** Keep the open attempt pointed at the same log entry after one is removed. */
  private adjustExerciseRound(definitionIndex: number, removedIndex: number): void {
    const shift = (indexes: Array<number | null>): Array<number | null> => {
      const next = indexes.slice();
      const current = next[definitionIndex];
      if (typeof current !== 'number' || current < removedIndex) return next;
      next[definitionIndex] = current === removedIndex ? null : current - 1;
      return next;
    };
    this.writeRound({
      ...this.round(),
      equivalentLogIndexes: shift(this.round().equivalentLogIndexes),
      definitionLogIndexes: shift(this.round().definitionLogIndexes ?? []),
    });
  }

  private async removeElement(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.element().id;
      await deleteElement(id);
      clearDefinitionSuggestions(id);
      dropNewDefinitions(id);
      writeExampleSuggestions(id, {});
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

  /** Examples generated before they were saved immediately. */
  private async commitStoredExamples(id: string): Promise<void> {
    const stored = readExampleSuggestions(id);
    if (this.element().id !== id) return;
    if (!Object.keys(stored).length) {
      this.exampleSuggestions.set({});
      return;
    }
    const definitions = this.copyDefinitions();
    const worked: number[] = [];
    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index];
      if (!definition) continue;
      const sense = senseKey(definition.text);
      const list = sense ? stored[sense] : undefined;
      if (!list?.length) continue;
      const saved = new Set(
        definition.examples.map((example) => senseKey(example.text)).filter(Boolean),
      );
      let added = false;
      for (const item of list) {
        const key = senseKey(item.text);
        if (!key || saved.has(key)) continue;
        definition.examples.push({ text: item.text, metadata: {} });
        this.appendExample(definition, item.text);
        saved.add(key);
        added = true;
      }
      if (added) worked.push(index);
    }
    if (!worked.length) {
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

  private currentElement(): StoredElement {
    const written = this.written;
    const element = this.element();
    return written?.id === element.id ? written : element;
  }

  private copyDefinitions(): ElementDefinition[] {
    return this.currentElement().definitions.map((definition) => this.copyDefinition(definition));
  }

  private copyRemovedDefinitions(): RemovedDefinition[] {
    return (this.currentElement().removedDefinitions ?? []).map((definition) => ({
      ...this.copyDefinition(definition),
      deletedAt: definition.deletedAt,
    }));
  }

  private copyDefinition(definition: ElementDefinition): ElementDefinition {
    return {
      ...definition,
      equivalentIds: { ...definition.equivalentIds },
      forms: definition.forms.map((form) => ({ text: form.text, metadata: { ...form.metadata } })),
      examples: definition.examples.map((example) => ({
        ...example,
        metadata: { ...example.metadata },
      })),
      metadata: { ...definition.metadata },
      log: definition.log.map((entry) => ({ ...entry })),
    };
  }

  /** Keep the log, and append a rework when the passage, equivalent, or metadata changed. */
  private logWithRework(
    current: ElementDefinition | null,
    text: string,
    equivalent: string,
    metadata: ElementMetadata,
  ): ElementDefinition['log'] {
    const log = current?.log.map((entry) => ({ ...entry })) ?? [];
    if (!current) return log;
    const before = this.snapshotWithMetadata(this.snapshotOf(current), current.metadata);
    const after = this.snapshotWithMetadata({ text, equivalent }, metadata);
    if (
      before.text === after.text &&
      before.equivalent === after.equivalent &&
      this.sameMetadata(current.metadata, metadata)
    ) {
      return log;
    }
    log.push({ event: 'rework', at: Date.now(), before, after });
    return log;
  }

  private snapshotWithMetadata(
    snapshot: DefinitionSnapshot,
    metadata: ElementMetadata,
  ): DefinitionSnapshot {
    const stored = { ...metadata };
    return Object.keys(stored).length
      ? { text: snapshot.text, equivalent: snapshot.equivalent, metadata: stored }
      : { text: snapshot.text, equivalent: snapshot.equivalent };
  }

  private sameMetadata(left: ElementMetadata, right: ElementMetadata): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if ((left[key] ?? '') !== (right[key] ?? '')) return false;
    }
    return true;
  }

  /** An added example keeps the definition it was added to. */
  private appendExample(definition: ElementDefinition, example: string): void {
    definition.log = [
      ...definition.log,
      { event: 'example', at: Date.now(), example, snapshot: this.snapshotOf(definition) },
    ];
  }

  /** Forms saved in one action keep the definition they were added to. */
  private appendForm(definition: ElementDefinition, forms: string[]): void {
    definition.log = [
      ...definition.log,
      { event: 'form', at: Date.now(), forms, snapshot: this.snapshotOf(definition) },
    ];
  }

  private snapshotOf(definition: ElementDefinition, equivalent?: string): DefinitionSnapshot {
    return {
      text: definition.text,
      equivalent: equivalent ?? this.equivalentWording(definition),
    };
  }

  private equivalentWording(definition: ElementDefinition): string {
    return equivalentTextFor(
      this.currentElement().equivalents,
      definition.equivalentIds,
      this.translationTarget(),
    );
  }

  /** First score captures the definition. A later score in the same round keeps that snapshot. */
  private withSnapshot(
    definition: ElementDefinition,
    current: DefinitionLogEntry | undefined,
    stored: DefinitionGameLog,
  ): DefinitionGameLog {
    const snapshot =
      current?.event === 'game' && current.snapshot
        ? current.snapshot
        : this.snapshotOf(definition);
    return { ...stored, snapshot };
  }

  /** Ignores the blur that follows Enter or Escape so the position is applied once. */
  private orderSettling = false;
  private deletePressTimer = 0;
  private deletePressHeld = false;
  private deletePressX = 0;
  private deletePressY = 0;

  noteReveal(
    index: number,
    phrase: string,
    translation: string,
    kind: 'definition' | 'example',
  ): void {
    const wording = phrase.trim();
    const meaning = translation.trim();
    if (!wording || !meaning) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return;
    definition.log = [
      ...definition.log,
      { event: 'reveal', at: Date.now(), phrase: wording, translation: meaning, kind },
    ];
    void this.persist(definitions, this.currentElement().equivalents, { busy: false });
  }

  activityCount(definition: ElementDefinition, event: 'rework' | 'view' | 'reveal'): number {
    return definition.log.filter((entry) => entry.event === event).length;
  }

  activityLabel(event: 'rework' | 'view' | 'reveal', count: number): string {
    const once =
      event === 'rework'
        ? 'Reworked 1 time'
        : event === 'view'
          ? 'Seen 1 time'
          : 'Translation revealed 1 time';
    const many =
      event === 'rework'
        ? `Reworked ${count} times`
        : event === 'view'
          ? `Seen ${count} times`
          : `Translation revealed ${count} times`;
    return count === 1 ? once : many;
  }

  private async persist(
    definitions: ElementDefinition[],
    equivalents: ElementEquivalent[],
    options?: { busy?: boolean; report?: boolean; removedDefinitions?: RemovedDefinition[] },
  ): Promise<boolean> {
    const current = this.currentElement();
    return this.commit(
      {
        ...current,
        definitions,
        equivalents,
        removedDefinitions: options?.removedDefinitions ?? current.removedDefinitions ?? [],
      },
      options,
    );
  }

  /** Save in order. A later edit is applied before an earlier save can replace it. */
  private commit(
    next: StoredElement,
    options?: { busy?: boolean; report?: boolean },
  ): Promise<boolean> {
    const busy = options?.busy !== false;
    const report = options?.report ?? busy;
    this.written = next;
    if (!busy) this.changed.emit(next);
    const snapshot = next;
    if (busy) {
      this.busySaves += 1;
      this.busy.set(true);
      if (report) this.error.set('');
    }
    const run = this.saveChain.then(async () => {
      try {
        const saved = await saveElement(snapshot);
        if (!this.alive || this.element().id !== saved.id) return true;
        if (this.written === snapshot) {
          this.written = saved;
          this.changed.emit(saved);
        }
        return true;
      } catch {
        if (this.written === snapshot) this.written = null;
        if (report && this.alive && this.element().id === snapshot.id) {
          this.error.set('Could not save this element.');
        }
        return false;
      } finally {
        if (busy) {
          this.busySaves = Math.max(0, this.busySaves - 1);
          if (this.busySaves === 0) this.busy.set(false);
        }
      }
    });
    this.saveChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private beginSheet(text: string): void {
    this.translateTicket += 1;
    this.equivalentTicket += 1;
    this.askingEquivalent.set(false);
    this.askingMetadata.set(false);
    this.seedEditingTranslations(text);
    this.textDraft.set(passageForEditing(text, this.translationTarget()));
    this.sheetError.set('');
    this.translating.set(false);
  }

  private phraseToStore(): string {
    return this.editingPassage(this.textDraft());
  }

  private writeTranslation(language: string, text: string): void {
    const gloss = readEditingDraft(this.textDraft()).text;
    this.captureEditingDraft(this.textDraft(), language);
    const stored = embedTranslation(this.storedFromTranslations(gloss), language, text);
    this.seedEditingTranslations(stored);
    this.textDraft.set(passageForEditing(stored, language));
  }

  private seedEditingTranslations(value: string): void {
    this.editingTranslations = new Map(
      parsePassage(value).translations.map((item) => [item.language, item.text]),
    );
  }

  private captureEditingDraft(draft: string, language: string): string {
    const edited = readEditingDraft(draft);
    if (language) {
      if (edited.translation) this.editingTranslations.set(language, edited.translation);
      else this.editingTranslations.delete(language);
    }
    return edited.text;
  }

  private storedFromTranslations(gloss: string): string {
    let text = gloss;
    for (const [language, body] of [...this.editingTranslations.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (body) text = embedTranslation(text, language, body);
    }
    return text;
  }

  private editingPassage(draft: string): string {
    return this.storedFromTranslations(this.captureEditingDraft(draft, this.translationTarget()));
  }

  private focusDraft(): void {
    setTimeout(() => this.draftField()?.nativeElement.focus());
  }

  /**
   * This card still has an unfinished exercise, or a result sheet is open.
   * Give up and help use this. A finished definition is not locked.
   */
  inPlay(): boolean {
    if (!this.playing()) return false;
    if (this.round().givenUp) return false;
    if (this.equivalentPromptOpen() || this.definitionPromptOpen() || this.examplePromptOpen()) {
      return true;
    }
    if (this.playMode() === 1) return this.supportAvailable() && !this.equivalentGameDone();
    if (this.playMode() === 2) return !this.exampleGameDone();
    if (this.playMode() === 3) return !this.definitionGameDone();
    return false;
  }

  /** This definition still owes its exercise, or its result sheet is open. */
  definitionInPlay(index: number): boolean {
    if (index < 0 || !this.playing() || this.round().givenUp) return false;
    const mode = this.playMode();
    if (mode !== 1 && mode !== 2 && mode !== 3) return false;
    if (
      this.equivalentPrompt() === index ||
      this.definitionPrompt() === index ||
      this.examplePrompt() === index
    ) {
      return true;
    }
    const definition = this.element().definitions[index];
    if (!definition) return false;
    return this.exercisePending(mode, index, definition);
  }

  equivalentGameDone(): boolean {
    if (this.playMode() !== 1) return false;
    const definitions = this.element().definitions;
    const included = this.round().included;
    let members = 0;
    let prompted = 0;
    for (let index = 0; index < definitions.length; index += 1) {
      if (included != null && included[index] !== true) continue;
      const definition = definitions[index];
      if (!definition) continue;
      members += 1;
      if (!this.equivalentText(definition)) continue;
      prompted += 1;
      if (!this.equivalentRewardAt(index)) return false;
    }
    if (included != null && members === 0) return true;
    return prompted > 0;
  }

  /** Every prompted definition has been graded. The result sheet is separate. */
  definitionGameDone(): boolean {
    if (this.playMode() !== 3) return false;
    const definitions = this.element().definitions;
    const included = this.round().included;
    let prompted = 0;
    for (let index = 0; index < definitions.length; index += 1) {
      if (included != null && included[index] !== true) continue;
      const definition = definitions[index];
      if (!definition) continue;
      prompted += 1;
      if (!this.definitionRewardAt(index)) return false;
    }
    if (included != null && prompted === 0) return true;
    return prompted > 0;
  }

  /** Translation play is hidden when this language has no support language. */
  shownPlayMode(): ElementMode | null {
    const mode = this.playMode();
    if (mode === 1 && !this.supportAvailable()) return null;
    return mode;
  }

  translationGame(index: number): boolean {
    return this.supportAvailable() && this.playMode() === 1 && this.definitionInPlay(index);
  }

  exampleGame(index: number): boolean {
    return this.playMode() === 2 && this.definitionInPlay(index);
  }

  /** Every definition with a gloss has been scored. The result sheet is separate. */
  exampleGameDone(): boolean {
    if (this.playMode() !== 2) return false;
    const definitions = this.element().definitions;
    const included = this.round().included;
    let members = 0;
    let prompted = 0;
    for (let index = 0; index < definitions.length; index += 1) {
      if (included != null && included[index] !== true) continue;
      const definition = definitions[index];
      if (!definition) continue;
      members += 1;
      const text = parsePassage(definition.text).text.trim();
      if (!text) continue;
      prompted += 1;
      if (!this.exampleRewardAt(index)) return false;
    }
    if (included != null && members === 0) return true;
    return prompted > 0;
  }

  /** The button for this definition, with how many exercises this game still has. */
  playCue(index: number): { label: string; left: number } | null {
    if (this.definitionConcealed(index)) {
      return { label: 'Write the definition', left: this.playLeft(3) };
    }
    if (this.translationCue(index)) {
      return { label: 'Write the equivalent', left: this.playLeft(1) };
    }
    if (this.exampleCue(index)) return { label: 'Write an example', left: this.playLeft(2) };
    return null;
  }

  openPlayCue(index: number): void {
    if (this.definitionConcealed(index)) {
      this.openDefinitionPrompt(index);
      return;
    }
    if (this.translationCue(index)) {
      this.openEquivalentPrompt(index);
      return;
    }
    if (this.exampleCue(index)) this.openExamplePrompt(index);
  }

  /** Exercises in this game that are not scored yet. */
  private playLeft(mode: ElementMode): number {
    return this.unscoredExerciseIndexes(mode, this.element().definitions).length;
  }

  /** This definition still needs its equivalent written. */
  translationCue(index: number): boolean {
    if (!this.translationGame(index) || this.equivalentSubmitted(index)) return false;
    const definition = this.element().definitions[index];
    return !!definition && this.equivalentText(definition).trim().length > 0;
  }

  /** This definition still needs an example. */
  exampleCue(index: number): boolean {
    if (!this.exampleGame(index)) return false;
    if (this.exampleRewardAt(index)) return false;
    const text = parsePassage(this.element().definitions[index]?.text ?? '').text.trim();
    return text.length > 0;
  }

  definitionGame(index: number): boolean {
    return this.playMode() === 3 && this.definitionInPlay(index);
  }

  /** A definition is still hidden. */
  definitionCue(): boolean {
    if (this.playMode() !== 3 || !this.playing() || this.round().givenUp) return false;
    return this.element().definitions.some((_, index) => this.definitionConcealed(index));
  }

  dialogLabel(): string {
    return this.shownTitle();
  }

  equivalentPromptOpen(): boolean {
    return this.equivalentPrompt() >= 0;
  }

  openEquivalentPrompt(index: number): void {
    if (!this.translationGame(index)) return;
    this.equivalentGradeError.set('');
    this.equivalentPrompt.set(index);
    if (!this.equivalentSubmitted(index)) setTimeout(() => this.focusEquivalentField());
  }

  private focusEquivalentField(): void {
    const field = this.equivalentField()?.nativeElement;
    if (field) {
      field.focus();
      return;
    }
    setTimeout(() => this.equivalentField()?.nativeElement.focus());
  }

  closeEquivalentPrompt(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.equivalentAwaitingScore()) return;
    this.equivalentPrompt.set(-1);
  }

  /** A submitted answer still needs a score before the sheet can close. */
  equivalentAwaitingScore(index = this.equivalentPrompt()): boolean {
    if (index < 0 || !this.equivalentSubmitted(index)) return false;
    return !this.equivalentRewardAt(index);
  }

  equivalentDraftAt(index: number): string {
    return this.round().equivalentDrafts[index] ?? '';
  }

  equivalentSubmitted(index: number): boolean {
    return this.round().equivalentSubmitted[index] === true;
  }

  onEquivalentDraft(index: number, event: Event): void {
    if (this.equivalentSubmitted(index)) return;
    const value = (event.target as HTMLInputElement).value.slice(0, EQUIVALENT_MAX);
    const equivalentDrafts = this.round().equivalentDrafts.slice();
    while (equivalentDrafts.length <= index) equivalentDrafts.push('');
    equivalentDrafts[index] = value;
    this.writeRound({ ...this.round(), equivalentDrafts });
  }

  submitEquivalent(index: number, event?: Event): void {
    event?.preventDefault();
    if (
      !this.translationGame(index) ||
      this.equivalentSubmitted(index) ||
      !this.equivalentDraftAt(index).trim()
    ) {
      return;
    }
    const equivalentSubmitted = this.round().equivalentSubmitted.slice();
    while (equivalentSubmitted.length <= index) equivalentSubmitted.push(false);
    equivalentSubmitted[index] = true;
    this.equivalentGradeError.set('');
    this.writeRound({ ...this.round(), equivalentSubmitted });
  }

  /** Concede this equivalent. The answer is shown and the attempt scores 0. */
  async giveUpEquivalent(index: number): Promise<void> {
    if (!this.translationGame(index) || this.equivalentSubmitted(index) || this.aiBusy()) return;
    this.equivalentGradeError.set('');
    const logIndex = await this.recordEquivalentReward(index, {
      score: 0,
      by: 'user',
      answer: '',
    });
    if (!this.alive) return;
    if (logIndex == null) {
      this.equivalentGradeError.set('Could not save this score.');
      return;
    }
    const equivalentDrafts = this.round().equivalentDrafts.slice();
    while (equivalentDrafts.length <= index) equivalentDrafts.push('');
    equivalentDrafts[index] = '';
    const equivalentSubmitted = this.round().equivalentSubmitted.slice();
    while (equivalentSubmitted.length <= index) equivalentSubmitted.push(false);
    equivalentSubmitted[index] = true;
    this.writeRound({ ...this.round(), equivalentDrafts, equivalentSubmitted });
    this.writeEquivalentReward(index, { score: 0, by: 'user', explanation: '' }, logIndex);
  }

  equivalentRewardAt(index: number): EquivalentReward | null {
    return this.round().equivalentRewards[index] ?? null;
  }

  /** Mean score for one exercise on this definition. Null when it has not been played. */
  exerciseAverage(definition: ElementDefinition, game: DefinitionGameLog['game']): string | null {
    let total = 0;
    let count = 0;
    for (const entry of definition.log) {
      if (entry.event !== 'game' || entry.game !== game || !Number.isFinite(entry.score)) continue;
      total += entry.score;
      count += 1;
    }
    if (!count) return null;
    return (total / count).toFixed(1);
  }

  exerciseAverageLabel(
    definition: ElementDefinition,
    game: DefinitionGameLog['game'],
    label: string,
  ): string {
    const average = this.exerciseAverage(definition, game);
    if (average == null) return `${label}, non applicable`;
    return `${label} average ${average} out of 5`;
  }

  logMode(game: DefinitionGameLog['game']): ElementMode {
    if (game === 'example') return 2;
    if (game === 'definition') return 3;
    return 1;
  }

  /** Reworks, saved examples, saved forms, exercises, reveals, and seen events for this definition. */
  definitionHistory(definition: ElementDefinition): DefinitionHistoryEntry[] {
    return definition.log
      .filter((entry): entry is DefinitionHistoryEntry => this.listedHistory(entry))
      .reverse();
  }

  historyTitle(entry: DefinitionHistoryEntry): string {
    if (entry.event === 'rework') return 'Reworked';
    if (entry.event === 'example') return 'Example';
    if (entry.event === 'form') return 'Forms';
    if (entry.event === 'view') return 'Seen';
    if (entry.event === 'reveal') return 'Revealed';
    return this.modeLabel(this.logMode(entry.game));
  }

  historyAria(definition: ElementDefinition, entry: DefinitionHistoryEntry): string {
    const when = this.exerciseWhen(entry.at);
    if (entry.event === 'game') {
      const gem = this.earnedGameGem(definition, entry) ? ', earned a gem' : '';
      return `${this.historyTitle(entry)}, score ${entry.score} out of 5${gem}, ${when}`;
    }
    return `${this.historyTitle(entry)}, ${when}`;
  }

  earnedGameGem(definition: ElementDefinition, entry: DefinitionGameLog): boolean {
    return gameEarnedGem(definition.log, entry);
  }

  scoreAria(definition: ElementDefinition, entry: DefinitionGameLog): string {
    const gem = this.earnedGameGem(definition, entry) ? ', earned a gem' : '';
    return `Score ${entry.score} out of 5${gem}`;
  }

  private listedHistory(entry: DefinitionLogEntry): entry is DefinitionHistoryEntry {
    return (
      entry.event === 'rework' ||
      entry.event === 'example' ||
      entry.event === 'form' ||
      entry.event === 'view' ||
      entry.event === 'reveal' ||
      entry.event === 'game'
    );
  }

  exerciseWhen(at: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(at);
  }

  /** The definition on screen. Stats read this definition only. */
  statsDefinition(): ElementDefinition | null {
    const index = this.exerciseLog();
    if (index < 0) return null;
    return this.currentElement().definitions[index] ?? null;
  }

  toggleExerciseEntry(index: number): void {
    this.exerciseEntry.update((current) => (current === index ? -1 : index));
  }

  openExerciseLog(index: number): void {
    if (this.definitionInPlay(index) || !this.currentElement().definitions[index]) return;
    this.exerciseEntry.set(-1);
    this.exerciseLog.set(index);
  }

  closeExerciseLog(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.exerciseEntry.set(-1);
    this.exerciseLog.set(-1);
  }

  private equivalentGaveUp(index: number): boolean {
    return this.equivalentSubmitted(index) && !this.equivalentDraftAt(index).trim();
  }

  async awardEquivalent(index: number, score: number): Promise<void> {
    if (!this.translationGame(index) || this.aiBusy() || !this.equivalentSubmitted(index)) return;
    if (this.equivalentGaveUp(index) || score < 0 || score > TRANSLATION_GEM_MAX) return;
    const current = this.equivalentRewardAt(index);
    if (current?.by === 'user' && current.score === score) return;
    const answer = this.equivalentDraftAt(index).trim();
    if (!answer) return;
    this.equivalentGradeError.set('');
    const logIndex = await this.recordEquivalentReward(index, { score, by: 'user', answer });
    if (!this.alive) return;
    if (logIndex == null) {
      this.equivalentGradeError.set('Could not save this score.');
      return;
    }
    if (this.equivalentDraftAt(index).trim() !== answer) return;
    this.writeEquivalentReward(index, { score, by: 'user', explanation: '' }, logIndex);
  }

  async judgeEquivalent(index: number): Promise<void> {
    if (this.aiBusy() || !this.equivalentSubmitted(index) || this.equivalentGaveUp(index)) return;
    if (this.equivalentRewardAt(index)?.by === 'ai') return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    const answer = this.equivalentDraftAt(index).trim();
    if (!definition || !gloss || !answer) return;
    const job = ++this.equivalentGradeJob;
    this.askingEquivalentGrade.set(index);
    this.equivalentGradeError.set('');
    try {
      const grade = await gradeEquivalent({
        language: element.language,
        lemma: element.title,
        definition: gloss,
        answer,
      });
      if (!this.alive || job !== this.equivalentGradeJob || this.element().id !== element.id)
        return;
      if (this.equivalentDraftAt(index).trim() !== answer) return;
      const logIndex = await this.recordEquivalentReward(index, {
        score: grade.score,
        by: 'ai',
        answer,
        explanation: grade.explanation,
      });
      if (!this.alive || job !== this.equivalentGradeJob || this.element().id !== element.id)
        return;
      if (this.equivalentDraftAt(index).trim() !== answer) return;
      if (logIndex == null) {
        this.equivalentGradeError.set('Could not save this score.');
        return;
      }
      this.writeEquivalentReward(
        index,
        { score: grade.score, by: 'ai', explanation: grade.explanation },
        logIndex,
      );
    } catch {
      if (this.alive && job === this.equivalentGradeJob && this.element().id === element.id) {
        this.equivalentGradeError.set('Could not judge that equivalent.');
      }
    } finally {
      if (this.alive && job === this.equivalentGradeJob) this.askingEquivalentGrade.set(null);
    }
  }

  private writeEquivalentReward(index: number, reward: EquivalentReward, logIndex: number): void {
    const equivalentRewards = this.round().equivalentRewards.slice();
    while (equivalentRewards.length <= index) equivalentRewards.push(null);
    equivalentRewards[index] = reward;
    const equivalentLogIndexes = this.round().equivalentLogIndexes.slice();
    while (equivalentLogIndexes.length <= index) equivalentLogIndexes.push(null);
    equivalentLogIndexes[index] = logIndex;
    this.writeRound({ ...this.round(), equivalentRewards, equivalentLogIndexes });
  }

  /** Append this attempt, or replace it when the learner changes the score. */
  private async recordEquivalentReward(
    index: number,
    entry: { score: number; by: DefinitionGameLog['by']; answer: string; explanation?: string },
  ): Promise<number | null> {
    const elementId = this.element().id;
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return null;
    const log = definition.log.map((item) => ({ ...item }));
    const stored: DefinitionGameLog = {
      event: 'game',
      game: 'translation',
      score: entry.score,
      by: entry.by,
      at: Date.now(),
      answer: entry.answer,
    };
    if (entry.explanation) stored.explanation = entry.explanation;
    let logIndex = this.round().equivalentLogIndexes[index];
    const current = typeof logIndex === 'number' ? log[logIndex] : undefined;
    const savedGame = this.withSnapshot(definition, current, stored);
    if (current?.event === 'game' && typeof logIndex === 'number') {
      log[logIndex] = savedGame;
    } else {
      log.push(savedGame);
      logIndex = log.length - 1;
    }
    definitions[index] = { ...definition, log };
    const saved = await this.persist(definitions, this.element().equivalents);
    if (!this.alive || !saved || this.element().id !== elementId) return null;
    return logIndex;
  }

  definitionDraftAt(index: number): string {
    return this.round().definitionDrafts[index] ?? '';
  }

  definitionConcealed(index: number): boolean {
    if (!this.definitionGame(index)) return false;
    if (this.definitionRewardAt(index) && this.definitionPrompt() !== index) return false;
    return true;
  }

  definitionPromptOpen(): boolean {
    return this.definitionPrompt() >= 0;
  }

  openDefinitionPrompt(index: number): void {
    if (!this.definitionConcealed(index)) return;
    this.error.set('');
    this.definitionSource.set(this.supportAvailable() ? 'support' : 'working');
    this.definitionPolishNote.set(null);
    this.definitionPrompt.set(index);
    setTimeout(() => (this.supportField() ?? this.definitionField())?.nativeElement.focus());
  }

  workDefinition(source: 'support' | 'working'): void {
    if (!this.supportAvailable() || this.translating() || this.askingPolish() !== null) return;
    this.definitionSource.set(source);
    setTimeout(() =>
      (source === 'support' ? this.supportField() : this.definitionField())?.nativeElement.focus(),
    );
  }

  definitionSupportDraftAt(index: number): string {
    return this.round().definitionSupportDrafts?.[index] ?? '';
  }

  canTranslateDefinition(index: number): boolean {
    if (
      !this.supportAvailable() ||
      this.translating() ||
      this.aiBusy() ||
      this.askingGrade() === index
    ) {
      return false;
    }
    const text =
      this.definitionSource() === 'support'
        ? this.definitionSupportDraftAt(index)
        : this.definitionDraftAt(index);
    return text.trim().length > 0;
  }

  /** Translate the visible draft into the other language, then show that tab. */
  async translateDefinition(index: number): Promise<void> {
    if (!this.canTranslateDefinition(index)) return;
    const towardWorking = this.definitionSource() === 'support';
    const sourceText = (
      towardWorking ? this.definitionSupportDraftAt(index) : this.definitionDraftAt(index)
    ).trim();
    const element = this.element();
    const support = this.translationTarget();
    const ticket = this.translateTicket;
    this.translating.set(true);
    this.error.set('');
    try {
      const [translated] = await translateTexts({
        texts: [sourceText],
        sourceLang: towardWorking ? support : element.language,
        targetLang: towardWorking ? element.language : support,
      });
      const result = String(translated ?? '')
        .trim()
        .slice(0, DEFINITION_MAX);
      if (!this.alive || ticket !== this.translateTicket || this.element().id !== element.id)
        return;
      if (!result) {
        this.error.set('Could not translate this.');
        return;
      }
      if (towardWorking) {
        const definitionDrafts = this.round().definitionDrafts.slice();
        while (definitionDrafts.length <= index) definitionDrafts.push('');
        definitionDrafts[index] = result;
        this.writeRound({ ...this.round(), definitionDrafts });
        this.definitionPolishNote.set(null);
        this.definitionSource.set('working');
        setTimeout(() => this.definitionField()?.nativeElement.focus());
      } else {
        const definitionSupportDrafts = this.round().definitionSupportDrafts?.slice() ?? [];
        while (definitionSupportDrafts.length <= index) definitionSupportDrafts.push('');
        definitionSupportDrafts[index] = result;
        this.writeRound({ ...this.round(), definitionSupportDrafts });
        this.definitionSource.set('support');
        setTimeout(() => this.supportField()?.nativeElement.focus());
      }
    } catch {
      if (this.alive && ticket === this.translateTicket && this.element().id === element.id) {
        this.error.set('Could not translate this.');
      }
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  canPolishDefinition(index: number): boolean {
    return (
      this.definitionDraftAt(index).trim().length > 0 &&
      !this.translating() &&
      this.askingPolish() === null
    );
  }

  /** Correct the working-language draft, or propose three other wordings above it. */
  async polishWorkingDefinition(index: number, task: PolishDefinitionTask): Promise<void> {
    if (!this.canPolishDefinition(index) || !this.definitionGame(index)) return;
    const element = this.element();
    const text = this.definitionDraftAt(index).trim();
    this.askingPolish.set(task);
    this.error.set('');
    try {
      const polished = await polishDefinition({ language: element.language, text, task });
      if (!this.alive || this.element().id !== element.id) return;
      if (this.definitionDraftAt(index).trim() !== text) return;
      if (polished.task === 'reformulate') {
        this.definitionPolishNote.set({
          task: 'reformulate',
          options: polished.options.map((option) => option.slice(0, DEFINITION_MAX)),
        });
        return;
      }
      const definitionDrafts = this.round().definitionDrafts.slice();
      while (definitionDrafts.length <= index) definitionDrafts.push('');
      definitionDrafts[index] = polished.text.slice(0, DEFINITION_MAX);
      this.writeRound({ ...this.round(), definitionDrafts });
      this.definitionPolishNote.set({ task: 'correct', explanation: polished.explanation });
    } catch {
      if (this.alive && this.element().id === element.id) {
        this.error.set('Could not rewrite this definition.');
      }
    } finally {
      if (this.alive) this.askingPolish.set(null);
    }
  }

  /** Put a proposed wording into the working-language field. The list stays. */
  useDefinitionProposition(index: number, option: string): void {
    const value = option.slice(0, DEFINITION_MAX);
    const definitionDrafts = this.round().definitionDrafts.slice();
    while (definitionDrafts.length <= index) definitionDrafts.push('');
    definitionDrafts[index] = value;
    this.writeRound({ ...this.round(), definitionDrafts });
  }

  onDefinitionSupportDraft(index: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value.slice(0, DEFINITION_MAX);
    const definitionSupportDrafts = this.round().definitionSupportDrafts?.slice() ?? [];
    while (definitionSupportDrafts.length <= index) definitionSupportDrafts.push('');
    definitionSupportDrafts[index] = value;
    this.writeRound({ ...this.round(), definitionSupportDrafts });
  }

  closeDefinitionPrompt(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    const index = this.definitionPrompt();
    if (this.askingGrade() !== null) return;
    if (index >= 0 && this.definitionAwaitingScore(index)) return;
    this.definitionPrompt.set(-1);
  }

  definitionSubmitted(index: number): boolean {
    return this.round().definitionSubmitted[index] === true;
  }

  /** A written answer is in, and it has not been scored yet. */
  definitionAwaitingScore(index: number): boolean {
    return this.definitionSubmitted(index) && !this.definitionRewardAt(index);
  }

  definitionRewardAt(index: number): EquivalentReward | null {
    return this.round().definitionRewards?.[index] ?? null;
  }

  private definitionGaveUp(index: number): boolean {
    return this.definitionSubmitted(index) && !this.definitionDraftAt(index).trim();
  }

  submitDefinition(index: number): void {
    if (!this.definitionGame(index) || this.aiBusy() || this.definitionSubmitted(index)) return;
    if (!this.definitionDraftAt(index).trim()) return;
    const definitionSubmitted = this.round().definitionSubmitted.slice();
    while (definitionSubmitted.length <= index) definitionSubmitted.push(false);
    definitionSubmitted[index] = true;
    this.error.set('');
    this.writeRound({ ...this.round(), definitionSubmitted });
  }

  onDefinitionDraft(index: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value.slice(0, DEFINITION_MAX);
    const definitionDrafts = this.round().definitionDrafts.slice();
    while (definitionDrafts.length <= index) definitionDrafts.push('');
    definitionDrafts[index] = value;
    this.definitionPolishNote.set(null);
    this.writeRound({ ...this.round(), definitionDrafts });
  }

  /** Concede this definition. The gloss is shown and the attempt scores 0. */
  async giveUpDefinition(index: number): Promise<void> {
    if (!this.definitionGame(index) || this.aiBusy() || this.definitionSubmitted(index)) return;
    const definition = this.element().definitions[index];
    if (!definition) return;
    this.error.set('');
    const logIndex = await this.recordDefinitionReward(index, { score: 0, by: 'user', answer: '' });
    if (!this.alive) return;
    if (logIndex == null) {
      this.error.set('Could not save this score.');
      return;
    }
    const definitionDrafts = this.round().definitionDrafts.slice();
    while (definitionDrafts.length <= index) definitionDrafts.push('');
    definitionDrafts[index] = '';
    const definitionSubmitted = this.round().definitionSubmitted?.slice() ?? [];
    while (definitionSubmitted.length <= index) definitionSubmitted.push(false);
    definitionSubmitted[index] = true;
    this.writeRound({
      ...this.round(),
      definitionDrafts,
      definitionSubmitted,
    });
    this.writeDefinitionReward(index, { score: 0, by: 'user', explanation: '' }, logIndex);
  }

  async awardDefinition(index: number, score: number): Promise<void> {
    if (!this.definitionGame(index) || this.aiBusy() || !this.definitionSubmitted(index)) return;
    if (this.definitionGaveUp(index) || score < 0 || score > TRANSLATION_GEM_MAX) return;
    const current = this.definitionRewardAt(index);
    if (current?.by === 'user' && current.score === score) return;
    const answer = this.definitionDraftAt(index).trim();
    if (!answer) return;
    this.error.set('');
    const logIndex = await this.recordDefinitionReward(index, { score, by: 'user', answer });
    if (!this.alive) return;
    if (logIndex == null) {
      this.error.set('Could not save this score.');
      return;
    }
    if (this.definitionDraftAt(index).trim() !== answer) return;
    this.writeDefinitionReward(index, { score, by: 'user', explanation: '' }, logIndex);
  }

  async evaluateDefinition(index: number): Promise<void> {
    if (this.aiBusy() || !this.definitionSubmitted(index) || this.definitionGaveUp(index)) return;
    if (this.definitionRewardAt(index)?.by === 'ai' || !this.definitionDraftAt(index).trim())
      return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    const answer = this.definitionDraftAt(index).trim();
    const job = ++this.gradeJob;
    this.askingGrade.set(index);
    this.error.set('');
    try {
      const grade = await gradeDefinition({
        language: element.language,
        lemma: element.title,
        gloss,
        answer,
      });
      if (!this.alive || job !== this.gradeJob || this.element().id !== element.id) return;
      if (this.definitionDraftAt(index).trim() !== answer) return;
      const logIndex = await this.recordDefinitionReward(index, {
        score: grade.score,
        by: 'ai',
        answer,
        explanation: grade.explanation,
      });
      if (!this.alive || job !== this.gradeJob || this.element().id !== element.id) return;
      if (this.definitionDraftAt(index).trim() !== answer) return;
      if (logIndex == null) {
        this.error.set('Could not save this score.');
        return;
      }
      this.writeDefinitionReward(
        index,
        { score: grade.score, by: 'ai', explanation: grade.explanation },
        logIndex,
      );
    } catch {
      if (this.alive && job === this.gradeJob && this.element().id === element.id) {
        this.error.set('Could not evaluate that definition.');
      }
    } finally {
      if (this.alive && job === this.gradeJob) this.askingGrade.set(null);
    }
  }

  private writeDefinitionReward(index: number, reward: EquivalentReward, logIndex: number): void {
    const definitionRewards = this.round().definitionRewards?.slice() ?? [];
    while (definitionRewards.length <= index) definitionRewards.push(null);
    definitionRewards[index] = reward;
    const definitionLogIndexes = this.round().definitionLogIndexes?.slice() ?? [];
    while (definitionLogIndexes.length <= index) definitionLogIndexes.push(null);
    definitionLogIndexes[index] = logIndex;
    this.writeRound({ ...this.round(), definitionRewards, definitionLogIndexes });
  }

  /** Append this attempt, or replace it when the learner changes the score. */
  private async recordDefinitionReward(
    index: number,
    entry: { score: number; by: DefinitionGameLog['by']; answer: string; explanation?: string },
  ): Promise<number | null> {
    const elementId = this.element().id;
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return null;
    const log = definition.log.map((item) => ({ ...item }));
    const stored: DefinitionGameLog = {
      event: 'game',
      game: 'definition',
      score: entry.score,
      by: entry.by,
      at: Date.now(),
      answer: entry.answer,
    };
    if (entry.explanation) stored.explanation = entry.explanation;
    let logIndex = this.round().definitionLogIndexes?.[index];
    const current = typeof logIndex === 'number' ? log[logIndex] : undefined;
    const savedGame = this.withSnapshot(definition, current, stored);
    if (current?.event === 'game' && typeof logIndex === 'number') {
      log[logIndex] = savedGame;
    } else {
      log.push(savedGame);
      logIndex = log.length - 1;
    }
    definitions[index] = { ...definition, log };
    const saved = await this.persist(definitions, this.element().equivalents);
    if (!this.alive || !saved || this.element().id !== elementId) return null;
    return logIndex;
  }

  examplePromptOpen(): boolean {
    return this.examplePrompt() >= 0;
  }

  openExamplePrompt(index: number): void {
    if (!this.exampleCue(index)) return;
    this.error.set('');
    this.exampleCorrection.set(null);
    this.exampleSource.set(this.supportAvailable() ? 'support' : 'working');
    this.examplePrompt.set(index);
    setTimeout(() => (this.exampleSupportField() ?? this.exampleField())?.nativeElement.focus());
  }

  closeExamplePrompt(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    const index = this.examplePrompt();
    if (this.askingExampleGrade() !== null) return;
    if (index >= 0 && this.exampleAwaitingScore(index)) return;
    this.examplePrompt.set(-1);
  }

  exampleDraftAt(index: number): string {
    return this.round().exampleDrafts?.[index] ?? '';
  }

  exampleSupportDraftAt(index: number): string {
    return this.round().exampleSupportDrafts?.[index] ?? '';
  }

  exampleSubmitted(index: number): boolean {
    return this.round().exampleSubmitted?.[index] === true;
  }

  exampleRewardAt(index: number): EquivalentReward | null {
    return this.round().exampleRewards?.[index] ?? null;
  }

  /** A written example is in, and the AI has not scored it yet. */
  exampleAwaitingScore(index: number): boolean {
    return (
      this.exampleSubmitted(index) &&
      !!this.exampleDraftAt(index).trim() &&
      !this.exampleRewardAt(index)
    );
  }

  private exampleGaveUp(index: number): boolean {
    return this.exampleSubmitted(index) && !this.exampleDraftAt(index).trim();
  }

  workExample(source: 'support' | 'working'): void {
    if (!this.supportAvailable() || this.translating() || this.askingPolish() !== null) return;
    this.exampleCorrection.set(null);
    this.exampleSource.set(source);
    setTimeout(() =>
      (source === 'support'
        ? this.exampleSupportField()
        : this.exampleField()
      )?.nativeElement.focus(),
    );
  }

  canTranslateExample(index: number): boolean {
    if (
      !this.supportAvailable() ||
      this.translating() ||
      this.aiBusy() ||
      this.askingExampleGrade() === index
    ) {
      return false;
    }
    const text =
      this.exampleSource() === 'support'
        ? this.exampleSupportDraftAt(index)
        : this.exampleDraftAt(index);
    return text.trim().length > 0;
  }

  /** Translate the visible draft into the other language, then show that tab. */
  async translateExample(index: number): Promise<void> {
    if (!this.canTranslateExample(index)) return;
    const towardWorking = this.exampleSource() === 'support';
    const sourceText = (
      towardWorking ? this.exampleSupportDraftAt(index) : this.exampleDraftAt(index)
    ).trim();
    const element = this.element();
    const support = this.translationTarget();
    const ticket = this.translateTicket;
    this.translating.set(true);
    this.error.set('');
    try {
      const [translated] = await translateTexts({
        texts: [sourceText],
        sourceLang: towardWorking ? support : element.language,
        targetLang: towardWorking ? element.language : support,
      });
      const result = String(translated ?? '')
        .trim()
        .slice(0, this.exampleLengthMax);
      if (!this.alive || ticket !== this.translateTicket || this.element().id !== element.id)
        return;
      if (!result) {
        this.error.set('Could not translate this.');
        return;
      }
      if (towardWorking) {
        const exampleDrafts = this.round().exampleDrafts?.slice() ?? [];
        while (exampleDrafts.length <= index) exampleDrafts.push('');
        exampleDrafts[index] = result;
        this.writeRound({ ...this.round(), exampleDrafts });
        this.exampleCorrection.set(null);
        this.exampleSource.set('working');
        setTimeout(() => this.exampleField()?.nativeElement.focus());
      } else {
        const exampleSupportDrafts = this.round().exampleSupportDrafts?.slice() ?? [];
        while (exampleSupportDrafts.length <= index) exampleSupportDrafts.push('');
        exampleSupportDrafts[index] = result;
        this.writeRound({ ...this.round(), exampleSupportDrafts });
        this.exampleCorrection.set(null);
        this.exampleSource.set('support');
        setTimeout(() => this.exampleSupportField()?.nativeElement.focus());
      }
    } catch {
      if (this.alive && ticket === this.translateTicket && this.element().id === element.id) {
        this.error.set('Could not translate this.');
      }
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  canCorrectExample(index: number): boolean {
    if (this.supportAvailable() && this.exampleSource() !== 'working') return false;
    if (this.translating() || this.askingPolish() !== null || this.askingExampleGrade() === index) {
      return false;
    }
    return this.exampleDraftAt(index).trim().length > 0;
  }

  /** Fix spelling in the visible draft. Wording and meaning stay as written. */
  async correctExample(index: number): Promise<void> {
    if (!this.canCorrectExample(index) || !this.exampleGame(index)) return;
    const element = this.element();
    const text = this.exampleDraftAt(index).trim();
    this.askingPolish.set('correct');
    this.error.set('');
    try {
      const polished = await polishExample({
        language: element.language,
        text,
      });
      if (!this.alive || this.element().id !== element.id) return;
      if (this.exampleDraftAt(index).trim() !== text) return;
      const exampleDrafts = this.round().exampleDrafts?.slice() ?? [];
      while (exampleDrafts.length <= index) exampleDrafts.push('');
      exampleDrafts[index] = polished.text.slice(0, this.exampleLengthMax);
      this.writeRound({ ...this.round(), exampleDrafts });
      this.exampleCorrection.set(polished.explanation);
    } catch {
      if (this.alive && this.element().id === element.id) {
        this.error.set('Could not correct this example.');
      }
    } finally {
      if (this.alive) this.askingPolish.set(null);
    }
  }

  onExampleSupportDraft(index: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value.slice(0, this.exampleLengthMax);
    const exampleSupportDrafts = this.round().exampleSupportDrafts?.slice() ?? [];
    while (exampleSupportDrafts.length <= index) exampleSupportDrafts.push('');
    exampleSupportDrafts[index] = value;
    this.exampleCorrection.set(null);
    this.writeRound({ ...this.round(), exampleSupportDrafts });
  }

  onExampleDraft(index: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value.slice(0, this.exampleLengthMax);
    const exampleDrafts = this.round().exampleDrafts?.slice() ?? [];
    while (exampleDrafts.length <= index) exampleDrafts.push('');
    exampleDrafts[index] = value;
    this.exampleCorrection.set(null);
    this.writeRound({ ...this.round(), exampleDrafts });
  }

  /** Submit needs a sentence. The grader decides whether a valid form was used. */
  exampleReady(index: number): boolean {
    return this.exampleDraftAt(index).trim().length > 0;
  }

  submitExample(index: number): void {
    if (
      !this.exampleGame(index) ||
      this.aiBusy() ||
      this.translating() ||
      this.exampleSubmitted(index)
    )
      return;
    if (!this.exampleReady(index)) return;
    const exampleSubmitted = this.round().exampleSubmitted?.slice() ?? [];
    while (exampleSubmitted.length <= index) exampleSubmitted.push(false);
    exampleSubmitted[index] = true;
    this.error.set('');
    this.writeRound({ ...this.round(), exampleSubmitted });
    void this.evaluateExample(index);
  }

  /** Concede this example. The attempt scores 0 and the saved examples stay hidden. */
  async giveUpExample(index: number): Promise<void> {
    if (!this.exampleGame(index) || this.aiBusy() || this.exampleSubmitted(index)) return;
    const text = parsePassage(this.element().definitions[index]?.text ?? '').text.trim();
    if (!text) return;
    this.error.set('');
    const logIndex = await this.recordExampleReward(index, { score: 0, by: 'user', answer: '' });
    if (!this.alive) return;
    if (logIndex == null) {
      this.error.set('Could not save this score.');
      return;
    }
    const exampleDrafts = this.round().exampleDrafts?.slice() ?? [];
    while (exampleDrafts.length <= index) exampleDrafts.push('');
    exampleDrafts[index] = '';
    const exampleSubmitted = this.round().exampleSubmitted?.slice() ?? [];
    while (exampleSubmitted.length <= index) exampleSubmitted.push(false);
    exampleSubmitted[index] = true;
    this.writeRound({ ...this.round(), exampleDrafts, exampleSubmitted });
    this.writeExampleReward(index, { score: 0, by: 'user', explanation: '' }, logIndex);
  }

  async evaluateExample(index: number): Promise<void> {
    if (this.askingExampleGrade() !== null) return;
    if (!this.exampleSubmitted(index) || this.exampleGaveUp(index)) return;
    if (this.exampleRewardAt(index) || !this.exampleDraftAt(index).trim()) return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    const answer = this.exampleDraftAt(index).trim();
    if (!definition || !gloss || !answer) return;
    const job = ++this.exampleGradeJob;
    this.askingExampleGrade.set(index);
    this.error.set('');
    try {
      const grade = await gradeExample({
        language: element.language,
        lemma: element.title,
        gloss,
        answer,
        forms: definition.forms.map((form) => form.text),
      });
      if (!this.alive || job !== this.exampleGradeJob || this.element().id !== element.id) return;
      if (this.exampleDraftAt(index).trim() !== answer) return;
      const logIndex = await this.recordExampleReward(index, {
        score: grade.score,
        by: 'ai',
        answer,
        explanation: grade.explanation,
      });
      if (!this.alive || job !== this.exampleGradeJob || this.element().id !== element.id) return;
      if (this.exampleDraftAt(index).trim() !== answer) return;
      if (logIndex == null) {
        this.error.set('Could not save this score.');
        return;
      }
      this.writeExampleReward(
        index,
        { score: grade.score, by: 'ai', explanation: grade.explanation },
        logIndex,
      );
    } catch {
      if (this.alive && job === this.exampleGradeJob && this.element().id === element.id) {
        this.error.set('Could not score that example.');
      }
    } finally {
      if (this.alive && job === this.exampleGradeJob) this.askingExampleGrade.set(null);
    }
  }

  private writeExampleReward(index: number, reward: EquivalentReward, logIndex: number): void {
    const exampleRewards = this.round().exampleRewards?.slice() ?? [];
    while (exampleRewards.length <= index) exampleRewards.push(null);
    exampleRewards[index] = reward;
    const exampleLogIndexes = this.round().exampleLogIndexes?.slice() ?? [];
    while (exampleLogIndexes.length <= index) exampleLogIndexes.push(null);
    exampleLogIndexes[index] = logIndex;
    this.writeRound({ ...this.round(), exampleRewards, exampleLogIndexes });
  }

  /** Append this attempt, or replace it when the learner tries again. */
  private async recordExampleReward(
    index: number,
    entry: { score: number; by: DefinitionGameLog['by']; answer: string; explanation?: string },
  ): Promise<number | null> {
    const elementId = this.element().id;
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return null;
    const log = definition.log.map((item) => ({ ...item }));
    const stored: DefinitionGameLog = {
      event: 'game',
      game: 'example',
      score: entry.score,
      by: entry.by,
      at: Date.now(),
      answer: entry.answer,
    };
    if (entry.explanation) stored.explanation = entry.explanation;
    let logIndex = this.round().exampleLogIndexes?.[index];
    const current = typeof logIndex === 'number' ? log[logIndex] : undefined;
    const savedGame = this.withSnapshot(definition, current, stored);
    if (current?.event === 'game' && typeof logIndex === 'number') {
      log[logIndex] = savedGame;
    } else {
      log.push(savedGame);
      logIndex = log.length - 1;
    }
    definitions[index] = { ...definition, log };
    const saved = await this.persist(definitions, this.element().equivalents);
    if (!this.alive || !saved || this.element().id !== elementId) return null;
    return logIndex;
  }

  private loadRound(id: string): void {
    const existing = this.rounds.get(id);
    if (existing) {
      this.round.set(existing);
      return;
    }
    const fresh = emptyPlayRound();
    this.rounds.set(id, fresh);
    this.round.set(fresh);
  }

  private writeRound(next: PlayRound): void {
    this.rounds.set(this.element().id, next);
    this.round.set(next);
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

function scoreColor(element: StoredElement): { color: string } {
  return { color: element.color ?? '' };
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

function ensureRootLemma(
  forms: { text: string; metadata: ElementMetadata }[],
  title: string,
): void {
  const lemma = title.trim();
  if (!lemma || /[*()|]/.test(lemma) || !isValidForm(lemma)) return;
  const key = lemma.toLowerCase();
  if (forms.some((form) => form.text.toLowerCase() === key)) return;
  forms.unshift({ text: lemma, metadata: {} });
}
