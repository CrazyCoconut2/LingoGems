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
  DEFINITION_COVERAGE_MAX,
  definitionCoverage,
  definitionScoreAverage,
  definitionScoreStep,
  displayTitle,
  attributeGem,
  storedGem,
  equivalentTextFor,
  linkEquivalent,
  parsePassage,
  type ParsedPassage,
  type GemTier,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  languageDisplayName,
  readOpenGrammarMistakes,
  type GrammarMistake,
  saveElement,
  sensesWithEquivalents,
  type DefinitionDeleteLog,
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
  type EquivalentLinks,
  type ElementLogEntry,
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
  generateDerivedExample,
  generateElementFromSelection,
  generateExamples,
  generateForms,
  generateRelatedWords,
  readStoredAiCredentials,
  suggestMetadata,
  sentenceUsesForm,
  verbalizeDefinition,
  type RecallExtra,
  type RecallSense,
  type RelatedWord,
} from 'ai';
import { DefinitionRecall, type RecallFinish } from './definition-recall';
import { GemIcon } from './gem-icon';
import { ShowText } from './show-text';
import { readFieldColor, type MetadataColorPlace } from './metadata-colors';
import { supportLanguageFor } from '../languages/translation-language';
import { UpwardQuotePipe } from '../text/upward-quote.pipe';
import { FeedbackTranslation } from '../translate/feedback-translation';
import { PhraseTranslation } from '../translate/phrase-translation';
import {
  readPhraseTranslation,
  replacePhraseTranslation,
  requestDefinitionTranslation,
  requestPhraseTranslation,
} from '../translate/translation-cache';
import { canSpeak, speakText, stopSpeaking } from './speech';

const EQUIVALENT_MAX = 200;
const FORM_MAX_LENGTH = 100;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;

type Editor =
  | { kind: 'definition'; index: number }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number | null };

type WorkTab = 'definitions' | 'examples' | 'forms';

type FormEdit = { definitionIndex: number; originalText: string | null };

type MetadataEdit = { previousKey: string | null };

type PassageSelection = {
  text: string;
  definitionIndex: number;
  exampleIndex: number | null;
  top: number;
  left: number;
  before: boolean;
  visible: boolean;
};

type PreparedElement = {
  title: string;
  language: string;
  definitions: Array<ElementDefinition & { equivalent?: string }>;
  example: string;
  definition: number;
  guide?: string;
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
  | DefinitionDeleteLog
  | DefinitionExampleLog
  | DefinitionFormLog
  | DefinitionRevealLog;

type ExampleDraft = {
  definitionIndex: number;
  text: string;
  metadata: ElementMetadata;
};

type PendingForms = {
  definitionIndex: number;
  forms: ElementForm[];
};

type ConfirmDelete =
  | { kind: 'element' }
  | { kind: 'definition'; index: number }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number }
  | { kind: 'exercise'; definitionIndex: number; historyIndex: number };

const NEW_DEFINITIONS_KEY = 'lingogem.definition-new.v1';

function definitionGloss(text: string): string {
  return parsePassage(text).text.trim().toLowerCase();
}

type SenseStage = 'examples' | 'open';

function shiftIndexMap<T>(map: ReadonlyMap<number, T>, by: number): Map<number, T> {
  const next = new Map<number, T>();
  for (const [index, value] of map) next.set(index + by, value);
  return next;
}

function plainPassage(value: string): string {
  return parsePassage(value).text.trim();
}

function dropIndexMap<T>(map: ReadonlyMap<number, T>, index: number): Map<number, T> {
  const next = new Map<number, T>();
  for (const [key, value] of map) {
    if (key === index) continue;
    next.set(key > index ? key - 1 : key, value);
  }
  return next;
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
  grammarOpen: boolean;
  grammarId: string;
};

type ExampleFieldKind = 'saved' | 'addition' | 'draft';

type ExampleFieldEngineer = {
  definitionIndex: number;
  kind: ExampleFieldKind;
  index: number | null;
  instruction: string;
  grammarOpen: boolean;
  grammarId: string;
};

type GrammarSurface = 'new' | 'field';

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
    FeedbackTranslation,
    UpwardQuotePipe,
    PhraseTranslation,
    ShowText,
    DefinitionRecall,
    GemIcon,
    CdkScrollable,
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
        [class.has-color]="scoreAverage() !== 'NA'"
        [style.--score-color]="scoreColorVar()"
      >
        <ng-template #grammarPick let-surface="surface">
          @if (grammarChoices().length) {
            <button
              type="button"
              class="forms-toggle"
              [attr.aria-expanded]="grammarPickerOpen(surface)"
              [disabled]="askingExamples() !== null"
              (click)="toggleGrammarPicker(surface)"
            >
              <span>Grammar</span>
              <span class="forms-toggle-side">
                @if (!grammarPickerOpen(surface) && grammarPickerLabel(surface); as label) {
                  <span>{{ label }}</span>
                }
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  [class.open]="grammarPickerOpen(surface)"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
            @if (grammarPickerOpen(surface)) {
              <ul class="grammar-picks">
                @for (mistake of grammarChoices(); track mistake.id) {
                  <li>
                    <button
                      type="button"
                      [class.selected]="grammarMistakeChosen(surface, mistake.id)"
                      [attr.aria-pressed]="grammarMistakeChosen(surface, mistake.id)"
                      [disabled]="askingExamples() !== null"
                      (click)="pickGrammarMistake(surface, mistake.id)"
                    >
                      <span class="grammar-change">{{ mistake.rule }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          }
        </ng-template>
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
        @if (passageSelection(); as pick) {
          @if (pick.visible) {
            <div
              class="lookup-actions lookup-float"
              [class.before]="pick.before"
              [style.top.px]="pick.top"
              [style.left.px]="pick.left"
              (pointerdown)="$event.preventDefault()"
            >
              <button
                type="button"
                class="lookup-chip"
                aria-label="Add element with AI"
                [disabled]="aiBusy()"
                [attr.aria-busy]="addingSelection() ? true : null"
                (pointerdown)="confirmPassagePick($event, pick.text)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                  />
                </svg>
                Ask AI
              </button>
            </div>
          }
        }
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
              <h2>
                <button
                  type="button"
                  class="element-title"
                  [class.has-color]="scoreAverage() !== 'NA'"
                  title="Edit element"
                  [disabled]="aiBusy()"
                  (click)="openTitle()"
                >
                  {{ shownTitle() }}
                </button>
              </h2>
              <ng-container
                [ngTemplateOutlet]="hearButton"
                [ngTemplateOutletContext]="{
                  key: 'title',
                  text: shownTitle(),
                  label: 'title',
                }"
              />
            </div>
            <div class="title-end">
              <button
                type="button"
                class="icon-btn"
                aria-label="History"
                title="History"
                [class.active]="historyOpen()"
                [attr.aria-pressed]="historyOpen()"
                [disabled]="recallPending()"
                (click)="toggleHistory()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
                  <path d="M18 17V9" />
                  <path d="M13 17V5" />
                  <path d="M8 17v-3" />
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
          @if (historyOpen()) {
            <div class="definition-stats">
              <div class="stats-summary">
                @let average = scoreAverage();
                <section
                  class="stats-hero"
                  [class.unscored]="average === 'NA'"
                  [style.--score-color]="scoreColorVar()"
                  [attr.aria-label]="scoreAverageLabel()"
                >
                  <p class="stats-eyebrow">Score</p>
                  <p class="stats-hero-value">
                    {{ average }}
                    @if (average !== 'NA') {
                      <span class="score-max">/10</span>
                    }
                  </p>
                </section>
                <section class="stats-block">
                  <h3>Activity</h3>
                  <ul class="stats-activity">
                    @let reworked = activityCount('rework');
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
                  </ul>
                </section>
              </div>
              @if (shownHistory().length) {
                <section class="stats-log">
                  <h3>History</h3>
                  <div class="add-choices">
                    @for (entry of shownHistory(); track $index) {
                      <div class="log-item">
                        <div class="log-row">
                          @if (entry.event === 'rework') {
                            <button
                              type="button"
                              class="log-open"
                              [attr.aria-expanded]="exerciseEntry() === $index"
                              [attr.aria-label]="historyAria(entry)"
                              (click)="toggleExerciseEntry($index)"
                            >
                              <span class="log-edit-line">
                                <svg class="log-wrench" viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                                  />
                                </svg>
                                <span class="log-edit-copies">
                                  <span class="log-game">Reworked</span>
                                  <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                                </span>
                              </span>
                              <svg
                                class="log-chevron"
                                [class.open]="exerciseEntry() === $index"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          } @else if (entry.event === 'delete') {
                            <button
                              type="button"
                              class="log-open"
                              [attr.aria-expanded]="exerciseEntry() === $index"
                              [attr.aria-label]="historyAria(entry)"
                              (click)="toggleExerciseEntry($index)"
                            >
                              <span class="log-edit-line">
                                <svg class="log-wrench" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                </svg>
                                <span class="log-edit-copies">
                                  <span class="log-game">Deleted a definition</span>
                                  <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                                </span>
                              </span>
                              <svg
                                class="log-chevron"
                                [class.open]="exerciseEntry() === $index"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          } @else if (entry.event === 'game' && gaveUp(entry)) {
                            <div class="log-copy">
                              <span class="log-edit-line">
                                <svg class="log-wrench" viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                                  />
                                  <path
                                    d="M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
                                  />
                                  <path d="m9 14 2 2 4-4" />
                                </svg>
                                <span class="log-edit-copies">
                                  <span class="log-game">You gave up</span>
                                  <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                                </span>
                              </span>
                            </div>
                          } @else {
                            <button
                              type="button"
                              class="log-open"
                              [attr.aria-expanded]="exerciseEntry() === $index"
                              (click)="toggleExerciseEntry($index)"
                            >
                              <span class="log-copy">
                                <span class="log-edit-line">
                                  <svg class="log-wrench" viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                                    />
                                    <path
                                      d="M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
                                    />
                                    <path d="m9 14 2 2 4-4" />
                                  </svg>
                                  <span class="log-edit-copies">
                                    <span class="log-game">Exercise</span>
                                    <span class="hint">{{ exerciseWhen(entry.at) }}</span>
                                  </span>
                                </span>
                              </span>
                              <svg
                                class="log-chevron"
                                [class.open]="exerciseEntry() === $index"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          }
                          @if (entry.event === 'game' && exerciseGem(entry); as tier) {
                            <span
                              class="gem-gain"
                              role="img"
                              [attr.data-gem]="tier"
                              [attr.aria-label]="earnedGemLabel(tier)"
                            >
                              <app-gem-icon class="gem-gain-stone" [tier]="tier" />
                            </span>
                          }
                          @if (entry.event === 'game' && gaveUp(entry)) {
                            <span
                              class="score-readout score-plain"
                              [attr.data-gem]="exerciseGem(entry)"
                              aria-label="Score 0 out of 10"
                            >
                              <span>0</span>
                              <span class="score-max">/10</span>
                            </span>
                          } @else if (entry.event === 'game') {
                            <label
                              class="score-readout"
                              [attr.data-gem]="exerciseGem(entry)"
                              [attr.aria-label]="scoreAria(entry)"
                            >
                              <input
                                class="score-input"
                                type="number"
                                inputmode="numeric"
                                [attr.min]="0"
                                [attr.max]="scoreMax"
                                [value]="shownGameScore(entry)"
                                [disabled]="busy()"
                                (change)="updateGameScore(entry, $event)"
                                (click)="$event.stopPropagation()"
                              />
                              <span class="score-max">/{{ scoreMax }}</span>
                              @if (entry.extra) {
                                <span class="score-max">+1</span>
                              }
                            </label>
                          }
                          @if (entry.event === 'delete') {
                            <button
                              type="button"
                              class="icon-btn"
                              aria-label="Restore"
                              title="Restore"
                              [disabled]="busy() || !canRestoreDefinition(entry)"
                              (click)="restoreDefinition(entry)"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                <path d="M3 3v5h5" />
                              </svg>
                            </button>
                          }
                          @if (entry.event !== 'rework') {
                            <button
                              type="button"
                              class="icon-btn danger log-delete"
                              aria-label="Delete"
                              title="Delete"
                              [disabled]="busy()"
                              (click)="askDeleteExercise(entry)"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </button>
                          }
                        </div>
                        @if (entry.event === 'rework' && exerciseEntry() === $index) {
                          <div class="log-detail log-versions">
                            <section class="log-version">
                              <span class="log-mark">Before</span>
                              <ng-container
                                [ngTemplateOutlet]="loggedSense"
                                [ngTemplateOutletContext]="{
                                  snapshot: entry.before,
                                  hearKey: 'rework-before:' + entry.at,
                                }"
                              />
                            </section>
                            <section class="log-version">
                              <span class="log-mark">After</span>
                              <ng-container
                                [ngTemplateOutlet]="loggedSense"
                                [ngTemplateOutletContext]="{
                                  snapshot: entry.after,
                                  hearKey: 'rework-after:' + entry.at,
                                }"
                              />
                            </section>
                          </div>
                        }
                        @if (entry.event === 'delete' && exerciseEntry() === $index) {
                          <div class="log-detail sense-body">
                            @let equivalent = deletedEquivalent(entry);
                            @let passage = parsePassage(entry.definition?.text ?? '');
                            <div class="sense-copy">
                              @if (passage.text) {
                                <div class="spoken">
                                  <div class="spoken-copy">
                                    <p class="passage">
                                      <ng-container
                                        [ngTemplateOutlet]="loggedWords"
                                        [ngTemplateOutletContext]="{ text: passage.text }"
                                      />
                                      @if (supportAvailable()) {
                                        <app-phrase-translation
                                          [phrase]="passage.text"
                                          [sourceLang]="element().language"
                                          [targetLang]="translationTarget()"
                                          [equivalent]="labeledEquivalent(equivalent)"
                                          [lemma]="element().title"
                                        />
                                      }
                                    </p>
                                  </div>
                                  <ng-container
                                    [ngTemplateOutlet]="hearButton"
                                    [ngTemplateOutletContext]="{
                                      key: 'deleted:' + entry.at,
                                      text: entry.definition?.text ?? '',
                                      label: 'definition',
                                    }"
                                  />
                                </div>
                              }
                              @let meta = entries(entry.definition?.metadata ?? {});
                              @if (
                                (supportAvailable() && equivalent && !passage.text) || meta.length
                              ) {
                                <ul class="sense-meta">
                                  @if (supportAvailable() && equivalent && !passage.text) {
                                    <li class="sense-equivalent">
                                      <ng-container [ngTemplateOutlet]="translationIcon" />
                                      <app-show-text
                                        [text]="labeledEquivalent(equivalent)"
                                        label="Show equivalent"
                                      />
                                    </li>
                                  }
                                  @for (field of meta; track field.key) {
                                    @let color = metaColor('definitions', field.key);
                                    <li [class.colored]="color" [style.--meta-color]="color">
                                      <span class="sense-meta-key">{{ label(field.key) }}</span>
                                      <span class="sense-meta-value">{{ label(field.value) }}</span>
                                    </li>
                                  }
                                </ul>
                              }
                            </div>
                            @if (entry.examples?.length) {
                              <ul class="examples" aria-label="Examples">
                                @for (example of entry.examples ?? []; track $index) {
                                  @let examplePassage = parsePassage(example.text);
                                  <li class="saved-example">
                                    <div class="example-quote">
                                      @if (examplePassage.text) {
                                        <div class="spoken">
                                          <div class="spoken-copy">
                                            <p class="passage">
                                              <ng-container
                                                [ngTemplateOutlet]="loggedWords"
                                                [ngTemplateOutletContext]="{
                                                  text: examplePassage.text,
                                                }"
                                              />
                                              @if (supportAvailable()) {
                                                <app-phrase-translation
                                                  [phrase]="examplePassage.text"
                                                  [sourceLang]="element().language"
                                                  [targetLang]="translationTarget()"
                                                />
                                              }
                                            </p>
                                          </div>
                                          <ng-container
                                            [ngTemplateOutlet]="hearButton"
                                            [ngTemplateOutletContext]="{
                                              key: 'deleted-example:' + entry.at + ':' + $index,
                                              text: example.text,
                                              label: 'example',
                                            }"
                                          />
                                        </div>
                                      }
                                      @if (entries(example.metadata); as exampleMeta) {
                                        @if (exampleMeta.length) {
                                          <ul class="pills">
                                            @for (field of exampleMeta; track field.key) {
                                              @let color = metaColor('examples', field.key);
                                              <li
                                                [class.colored]="color"
                                                [style.--meta-color]="color"
                                              >
                                                <span>
                                                  <span class="sense-meta-key">{{
                                                    label(field.key)
                                                  }}</span>
                                                  <span class="sense-meta-value">{{
                                                    label(field.value)
                                                  }}</span>
                                                </span>
                                              </li>
                                            }
                                          </ul>
                                        }
                                      }
                                    </div>
                                  </li>
                                }
                              </ul>
                            }
                            @if (entry.forms?.length) {
                              <ul class="forms" aria-label="Forms">
                                @for (form of entry.forms ?? []; track form.text) {
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
                            }
                          </div>
                        }
                        @if (
                          entry.event === 'game' && !gaveUp(entry) && exerciseEntry() === $index
                        ) {
                          <div class="log-detail feedback-note">
                            <div class="log-detail-head">
                              <span class="log-game">Feedback</span>
                              <app-feedback-translation
                                #note
                                [text]="entry.explanation || entry.answer"
                                [sourceLang]="element().language"
                                [targetLang]="translationTarget()"
                              />
                            </div>
                            <p class="log-feedback">
                              {{ entry.explanation || entry.answer | upwardQuote }}
                            </p>
                            @if (note.shown(); as text) {
                              <p class="log-translation">{{ text | upwardQuote }}</p>
                            }
                          </div>
                        }
                        <ng-template #loggedSense let-snapshot="snapshot" let-hearKey="hearKey">
                          @let equivalent = snapshot?.equivalent ?? '';
                          @let passage = parsePassage(snapshot?.text ?? '');
                          <div class="sense-body">
                            <div class="sense-copy">
                              @if (passage.text) {
                                <div class="spoken">
                                  <div class="spoken-copy">
                                    <p class="passage">
                                      <ng-container
                                        [ngTemplateOutlet]="loggedWords"
                                        [ngTemplateOutletContext]="{ text: passage.text }"
                                      />
                                      @if (supportAvailable()) {
                                        <app-phrase-translation
                                          [phrase]="passage.text"
                                          [sourceLang]="element().language"
                                          [targetLang]="translationTarget()"
                                          [equivalent]="labeledEquivalent(equivalent)"
                                          [lemma]="element().title"
                                        />
                                      }
                                    </p>
                                  </div>
                                  <ng-container
                                    [ngTemplateOutlet]="hearButton"
                                    [ngTemplateOutletContext]="{
                                      key: hearKey,
                                      text: snapshot?.text ?? '',
                                      label: 'definition',
                                    }"
                                  />
                                </div>
                              }
                              @let meta = entries(snapshot?.metadata ?? {});
                              @if (
                                (supportAvailable() && equivalent.trim() && !passage.text) ||
                                meta.length
                              ) {
                                <ul class="sense-meta">
                                  @if (supportAvailable() && equivalent.trim() && !passage.text) {
                                    <li class="sense-equivalent">
                                      <ng-container [ngTemplateOutlet]="translationIcon" />
                                      <app-show-text
                                        [text]="labeledEquivalent(equivalent)"
                                        label="Show equivalent"
                                      />
                                    </li>
                                  }
                                  @for (field of meta; track field.key) {
                                    @let color = metaColor('definitions', field.key);
                                    <li [class.colored]="color" [style.--meta-color]="color">
                                      <span class="sense-meta-key">{{ label(field.key) }}</span>
                                      <span class="sense-meta-value">{{ label(field.value) }}</span>
                                    </li>
                                  }
                                </ul>
                              }
                            </div>
                          </div>
                        </ng-template>
                        <ng-template #loggedWords let-text="text">
                          @for (part of highlightPassage(text); track $index) {
                            @if (part.matches.length > 1) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [style.--score-color]="part.color || null"
                                [textContent]="part.text"
                                (click)="showCollision($event, part.matches, -1, '', part.text)"
                              ></button>
                            } @else if (part.matches.length === 1 && !part.current) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [style.--score-color]="part.color || null"
                                [textContent]="part.text"
                                (click)="
                                  openFromDefinition(part.matches[0].elementId, -1, part.text)
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
                        </ng-template>
                      </div>
                    }
                  </div>
                </section>
              } @else {
                <p class="hint history-empty">No answers yet.</p>
              }
            </div>
          }
          <div class="element-view" [class.offstage]="historyOpen()">
            @if (element().definitions.length && !recallSkipped()) {
              <app-definition-recall
                [elementId]="element().id"
                [lemma]="shownTitle()"
                [learningLanguage]="element().language"
                [supportLanguage]="translationTarget()"
                [senses]="recallSenses()"
                [examples]="recallExamples()"
                [settled]="recallSettled()"
                (finished)="finishRecall($event)"
                (acceptExtra)="acceptRecallExtra($event)"
              />
            }
            @if (element().definitions.length && !recallPending()) {
              @let definitions = shownDefinitions();
              <ol class="definitions">
                @for (definition of definitions; track $index) {
                  @let index = $index;
                  <li
                    class="sense"
                    [class.open]="senseStage(index) === 'open'"
                    [attr.id]="'sense-' + index"
                    (click)="onSenseClick($event, index)"
                  >
                    @if (senseStage(index) !== 'open') {
                      <div class="sense-row" [class.actionable]="true">
                        <span class="sense-index">Definition {{ index + 1 }}</span>
                        <div class="sense-rail">
                          <div class="sense-actions">
                            @if (senseStage(index) === 'closed') {
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Show examples"
                                title="Show examples"
                                (click)="unveilExamples(index)"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                                  />
                                  <path
                                    d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                                  />
                                </svg>
                              </button>
                            } @else {
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Show definition"
                                title="Show definition"
                                (click)="unveilDefinitionText(index)"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
                                  />
                                  <path d="m8 13 4-7 4 7" />
                                  <path d="M9.1 11h5.7" />
                                </svg>
                              </button>
                            }
                          </div>
                        </div>
                      </div>
                    }
                    @if (senseStage(index) !== 'closed') {
                      <div class="sense-body">
                        @if (senseStage(index) === 'open') {
                          <div class="sense-main">
                            <div class="sense-copy">
                              @let passage = parsePassage(definition.text);
                              @let equivalent = equivalentText(definition);
                              <ng-container [ngTemplateOutlet]="definitionPassage" />
                              <ng-template #definitionPencil>
                                <button
                                  type="button"
                                  class="inline-pencil"
                                  aria-label="Edit definition"
                                  title="Edit definition"
                                  [disabled]="aiBusy()"
                                  (click)="openDefinition(index); $event.stopPropagation()"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  </svg>
                                </button>
                              </ng-template>
                              <ng-template #definitionPassage>
                                @if (passage.text) {
                                  <div class="spoken">
                                    <div class="spoken-copy">
                                      <p
                                        class="passage sense-selectable"
                                        [attr.data-definition-index]="index"
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
                                                  index,
                                                  '',
                                                  part.text
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
                                                openFromDefinition(
                                                  part.matches[0].elementId,
                                                  index,
                                                  part.text
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
                                        <ng-container [ngTemplateOutlet]="definitionPencil" />
                                        @if (supportAvailable() && passage.text) {
                                          <app-phrase-translation
                                            [phrase]="passage.text"
                                            [sourceLang]="element().language"
                                            [targetLang]="translationTarget()"
                                            [equivalent]="labeledEquivalent(equivalent)"
                                            [lemma]="element().title"
                                            (equivalentFound)="noteEquivalent(index, $event)"
                                          />
                                        }
                                      </p>
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
                                } @else {
                                  <ng-container [ngTemplateOutlet]="definitionPencil" />
                                }
                              </ng-template>
                              @let meta = entries(definition.metadata);
                              @if (
                                (supportAvailable() && equivalent && !passage.text) || meta.length
                              ) {
                                <ul class="sense-meta">
                                  @if (supportAvailable() && equivalent && !passage.text) {
                                    <li class="sense-equivalent">
                                      <ng-container [ngTemplateOutlet]="translationIcon" />
                                      <app-show-text
                                        [text]="labeledEquivalent(equivalent)"
                                        label="Show equivalent"
                                      />
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
                            </div>
                          </div>
                        }
                        <section class="group examples-region">
                          @if (definition.examples.length) {
                            <ul class="examples" aria-label="Examples">
                              @for (
                                exampleIndex of exampleIndexesNewestFirst(
                                  definition.examples.length
                                );
                                track exampleIndex
                              ) {
                                @let example = definition.examples[exampleIndex];
                                <li class="saved-example">
                                  <div class="example-quote">
                                    @let passage = parsePassage(example.text);
                                    @if (passage.text) {
                                      <div class="spoken">
                                        <div class="spoken-copy">
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
                                              } @else if (
                                                part.matches.length === 1 && !part.current
                                              ) {
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
                                            <button
                                              type="button"
                                              class="inline-pencil"
                                              aria-label="Edit examples"
                                              title="Edit examples"
                                              [disabled]="aiBusy()"
                                              (click)="
                                                openExamples(index); $event.stopPropagation()
                                              "
                                            >
                                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path
                                                  d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
                                                />
                                              </svg>
                                            </button>
                                            @if (supportAvailable() && passage.text) {
                                              <app-phrase-translation
                                                [phrase]="passage.text"
                                                [sourceLang]="element().language"
                                                [targetLang]="translationTarget()"
                                              />
                                            }
                                          </p>
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
                                            <li
                                              [class.colored]="color"
                                              [style.--meta-color]="color"
                                            >
                                              <span>
                                                <span class="sense-meta-key">{{
                                                  label(entry.key)
                                                }}</span>
                                                <span class="sense-meta-value">{{
                                                  label(entry.value)
                                                }}</span>
                                              </span>
                                            </li>
                                          }
                                        </ul>
                                      }
                                    }
                                  </div>
                                </li>
                              }
                            </ul>
                          } @else {
                            <button
                              type="button"
                              class="example-cta"
                              [disabled]="aiBusy()"
                              (click)="addExampleManually(index)"
                            >
                              Add an example
                            </button>
                          }
                        </section>
                        @if (senseStage(index) === 'open') {
                          <section class="group forms-region" (click)="onFormsClick($event, index)">
                            <ul class="forms" aria-label="Forms">
                              @if (definition.forms.length) {
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
                              } @else {
                                <li>
                                  <button
                                    type="button"
                                    class="form-chip readonly form-cta"
                                    [disabled]="aiBusy()"
                                    (click)="openForms(index)"
                                  >
                                    Add forms
                                  </button>
                                </li>
                              }
                            </ul>
                          </section>
                        }
                      </div>
                    }
                  </li>
                }
              </ol>
            } @else if (!element().definitions.length) {
              <p class="empty">No definitions yet.</p>
            }
          </div>
        </div>
        @if (!recallPending() && !historyOpen()) {
          <footer class="definition-footer">
            <form class="example-slot" (submit)="submitDefinitionExample($event)">
              <div class="example-slot-field" [class.arrived]="!!heldExample() || guidedExample()">
                @if (guidedExample()) {
                  <div class="example-slot-text">
                    <p>{{ arrivedGuide() }}</p>
                  </div>
                } @else if (heldExample(); as held) {
                  @let passage = parsePassage(held);
                  <div class="example-slot-text">
                    @if (passage.text) {
                      <p>
                        {{ passage.text }}
                        @if (supportAvailable()) {
                          <app-phrase-translation
                            [phrase]="passage.text"
                            [sourceLang]="element().language"
                            [targetLang]="translationTarget()"
                          />
                        }
                      </p>
                    }
                  </div>
                } @else {
                  <input
                    type="text"
                    [value]="definitionExample()"
                    [attr.maxlength]="exampleLengthMax"
                    [disabled]="aiBusy()"
                    [placeholder]="examplePlaceholder()"
                    [attr.aria-label]="examplePlaceholder()"
                    aria-describedby="example-slot-hint"
                    (input)="definitionExample.set(inputValue($event))"
                  />
                }
                @if (definitionExample().trim()) {
                  <button
                    type="button"
                    class="example-slot-clear"
                    aria-label="Clear example"
                    [disabled]="aiBusy()"
                    (click)="clearExampleSlot()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                }
                <button
                  type="submit"
                  class="example-slot-submit"
                  [attr.aria-label]="guidedExample() ? 'Create example' : 'Add example'"
                  [disabled]="aiBusy() || (!definitionExample().trim() && !arrivedGuide())"
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
                @if (arrivedGuide() && !definitionExample().trim()) {
                  Create an example that uses both. Press again to match it to a definition, or add
                  one.
                } @else {
                  This sentence is matched to a definition that already fits, or a new definition is
                  added.
                }
              </p>
            </form>
          </footer>
        }
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
              <div class="sheet-head">
                @if (current.kind === 'definition') {
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
                      [disabled]="!canOpenWorkSection()"
                      (click)="showWorkTab('examples')"
                    >
                      Examples
                    </button>
                    <button
                      type="button"
                      role="tab"
                      [class.on]="workTab() === 'forms'"
                      [attr.aria-selected]="workTab() === 'forms'"
                      [disabled]="!canOpenWorkSection()"
                      (click)="showWorkTab('forms')"
                    >
                      Forms
                    </button>
                  </div>
                } @else {
                  <h3>{{ sheetTitle(current) }}</h3>
                }
                @if (current.kind === 'example') {
                  <span class="sheet-tools">
                    <ng-container [ngTemplateOutlet]="draftActions" />
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Close"
                      [disabled]="workCloseDisabled()"
                      (click)="closeEditor()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </span>
                }
              </div>
              <ng-template #draftActions>
                <span class="header-actions work-title-actions">
                  @if (supportAvailable()) {
                    <button
                      type="button"
                      class="icon-btn"
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
                  }
                  @if (current.kind === 'definition') {
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
                          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                        />
                      </svg>
                    </button>
                  }
                  @if (current.kind === 'example' && current.exampleIndex == null) {
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Engineer example"
                      title="Engineer example"
                      [class.active]="exampleEngineerOpen()"
                      [attr.aria-pressed]="exampleEngineerOpen()"
                      [attr.aria-busy]="askingExamples() !== null ? true : null"
                      [disabled]="aiBusy() && !exampleEngineerOpen()"
                      (click)="toggleExampleEngineer()"
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
              </ng-template>
              <ng-template #editorFields>
                <div
                  class="definition-slot"
                  [class.engineering]="
                    (current.kind === 'definition' && !!definitionEngineer()) ||
                    exampleEngineerOpen()
                  "
                >
                  @if (current.kind === 'definition') {
                    <div class="field-heading">
                      <span class="field-label">Definition</span>
                      <ng-container [ngTemplateOutlet]="draftActions" />
                    </div>
                  }
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
                  @if (exampleEngineerOpen()) {
                    @if (exampleEngineer(); as engineer) {
                      <div class="definition-ai">
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
                        <ng-container
                          [ngTemplateOutlet]="grammarPick"
                          [ngTemplateOutletContext]="{ surface: 'new' }"
                        />
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
                      </div>
                    }
                  }
                  <div class="draft-field" [class.square]="current.kind === 'definition'">
                    <textarea
                      #draftField
                      [id]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                      [attr.aria-label]="current.kind === 'definition' ? 'Definition' : 'Example'"
                      rows="3"
                      [disabled]="asking()"
                      [value]="textDraft()"
                      (input)="textDraft.set(inputValue($event))"
                    ></textarea>
                    @if (supportAvailable()) {
                      <p class="draft-translation">
                        <textarea
                          class="line-edit"
                          rows="1"
                          [value]="definitionTranslationField()"
                          [disabled]="translating() || !draftGloss()"
                          placeholder="Translation"
                          aria-label="Translation"
                          (input)="onDefinitionTranslationInput($event)"
                          (blur)="commitDefinitionTranslation()"
                          (keydown.enter)="$event.preventDefault()"
                        ></textarea>
                        @if (current.kind === 'definition') {
                          <span class="equivalent">
                            <textarea
                              class="line-edit"
                              rows="1"
                              [value]="definitionEquivalentField()"
                              [attr.maxlength]="equivalentMax"
                              placeholder="Equivalent"
                              aria-label="Equivalent"
                              (input)="onDefinitionEquivalentInput($event)"
                              (blur)="commitDefinitionEquivalent()"
                              (keydown.enter)="$event.preventDefault()"
                            ></textarea>
                          </span>
                        }
                      </p>
                    }
                  </div>
                </div>
                @if (sheetError()) {
                  <p class="error">{{ sheetError() }}</p>
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
                            <span class="sense-meta-key">{{ label(entry.key) }}</span>
                            <span class="sense-meta-value">{{ label(entry.value) }}</span>
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
                @if (current.kind === 'definition' && workTab() === 'definitions') {
                  <section class="sheet-part work-section">
                    <ng-container [ngTemplateOutlet]="editorFields" />
                  </section>
                }
                @if (current.kind === 'definition' && workTab() === 'examples') {
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
                    <ng-template
                      #exampleTranslateButton
                      let-phrase="phrase"
                      let-raw="raw"
                      let-key="key"
                    >
                      @if (supportAvailable()) {
                        <button
                          type="button"
                          class="icon-btn"
                          [attr.aria-label]="
                            translatingExample() === key ? 'Translating…' : 'Translate'
                          "
                          [attr.title]="translatingExample() === key ? 'Translating…' : 'Translate'"
                          [attr.aria-busy]="translatingExample() === key ? true : null"
                          [disabled]="!canTranslateListedExample(phrase, key)"
                          (click)="translateListedExample(phrase, key)"
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
                      }
                    </ng-template>
                    <ng-template #exampleWrench let-work="work" let-kind="kind" let-index="index">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Engineer example"
                        title="Engineer example"
                        [class.active]="exampleFieldOpen(work, kind, index)"
                        [attr.aria-pressed]="exampleFieldOpen(work, kind, index)"
                        [attr.aria-busy]="exampleFieldBusy(work, kind, index) ? true : null"
                        [disabled]="aiBusy() && !exampleFieldOpen(work, kind, index)"
                        (click)="toggleExampleField(work, kind, index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                          />
                        </svg>
                      </button>
                    </ng-template>
                    <ng-template
                      #exampleField
                      let-work="work"
                      let-kind="kind"
                      let-index="index"
                      let-phrase="phrase"
                      let-raw="raw"
                      let-label="label"
                      let-placeholder="placeholder"
                    >
                      @if (exampleFieldOpen(work, kind, index)) {
                        <div class="definition-ai">
                          <div class="instruct-field">
                            <input
                              [value]="exampleFieldEngineer()?.instruction ?? ''"
                              [attr.maxlength]="exampleInstructionMax"
                              [disabled]="askingExamples() !== null"
                              [attr.placeholder]="exampleFieldPrompt(phrase)"
                              [attr.aria-label]="exampleFieldPrompt(phrase)"
                              (input)="onExampleFieldInstruction($event)"
                              (keydown.enter)="$event.preventDefault(); generateExampleField()"
                            />
                            <button
                              type="button"
                              class="entry-confirm"
                              [attr.aria-label]="phrase.trim() ? 'Modify example' : 'Write example'"
                              [disabled]="exampleFieldGenerateDisabled()"
                              [attr.aria-busy]="exampleFieldBusy(work, kind, index) ? true : null"
                              (click)="generateExampleField()"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            </button>
                          </div>
                          <ng-container
                            [ngTemplateOutlet]="grammarPick"
                            [ngTemplateOutletContext]="{ surface: 'field' }"
                          />
                        </div>
                      }
                      <div class="draft-field square">
                        <textarea
                          [class.example-addition]="kind === 'addition'"
                          rows="3"
                          [value]="phrase"
                          [disabled]="aiBusy()"
                          [attr.placeholder]="placeholder || null"
                          [attr.aria-label]="label"
                          (input)="onListedExampleInput(work, kind, index, $event)"
                        ></textarea>
                        @if (supportAvailable() && phrase.trim()) {
                          <p class="draft-translation">
                            <textarea
                              class="line-edit"
                              rows="1"
                              [value]="exampleTranslationField(phrase)"
                              placeholder="Translation"
                              aria-label="Translation"
                              (input)="onExampleTranslationInput(phrase, $event)"
                              (blur)="commitExampleTranslation(phrase)"
                              (keydown.enter)="$event.preventDefault()"
                            ></textarea>
                          </p>
                        }
                      </div>
                    </ng-template>
                    @if (
                      worked &&
                      (worked.examples.length ||
                        exampleAdditionIndexes(workIndex).length ||
                        exampleDraftFor(workIndex))
                    ) {
                      <ul class="examples">
                        @for (
                          additionIndex of exampleAdditionIndexes(workIndex);
                          track additionIndex
                        ) {
                          <li class="saved-example">
                            <div class="field-heading">
                              <span class="field-label">New example</span>
                              <span class="header-actions">
                                <ng-container
                                  [ngTemplateOutlet]="exampleTranslateButton"
                                  [ngTemplateOutletContext]="{
                                    phrase: exampleAdditionValue(workIndex, additionIndex),
                                    raw: '',
                                    key: 'add:' + workIndex + ':' + additionIndex,
                                  }"
                                />
                                <ng-container
                                  [ngTemplateOutlet]="exampleWrench"
                                  [ngTemplateOutletContext]="{
                                    work: workIndex,
                                    kind: 'addition',
                                    index: additionIndex,
                                  }"
                                />
                                <button
                                  type="button"
                                  class="icon-btn danger"
                                  aria-label="Remove example"
                                  title="Remove example"
                                  [disabled]="aiBusy()"
                                  (click)="removeExampleAddition(workIndex, additionIndex)"
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
                            <ng-container
                              [ngTemplateOutlet]="exampleField"
                              [ngTemplateOutletContext]="{
                                work: workIndex,
                                kind: 'addition',
                                index: additionIndex,
                                phrase: exampleAdditionValue(workIndex, additionIndex),
                                raw: '',
                                label: 'New example',
                                placeholder: 'Add an example',
                              }"
                            />
                          </li>
                        }
                        @if (exampleDraftFor(workIndex); as draft) {
                          <li class="saved-example">
                            <div class="field-heading">
                              <span class="field-label">New example</span>
                              <span class="header-actions">
                                <ng-container
                                  [ngTemplateOutlet]="exampleTranslateButton"
                                  [ngTemplateOutletContext]="{
                                    phrase: exampleDraftFieldValue(workIndex),
                                    raw: draft.text,
                                    key: 'draft:' + workIndex,
                                  }"
                                />
                                <ng-container
                                  [ngTemplateOutlet]="exampleWrench"
                                  [ngTemplateOutletContext]="{
                                    work: workIndex,
                                    kind: 'draft',
                                    index: null,
                                  }"
                                />
                                <button
                                  type="button"
                                  class="icon-btn danger"
                                  aria-label="Remove example"
                                  title="Remove example"
                                  [disabled]="aiBusy()"
                                  (click)="discardExampleDraft()"
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
                            <ng-container
                              [ngTemplateOutlet]="exampleField"
                              [ngTemplateOutletContext]="{
                                work: workIndex,
                                kind: 'draft',
                                index: null,
                                phrase: exampleDraftFieldValue(workIndex),
                                raw: draft.text,
                                label: 'New example',
                                placeholder: '',
                              }"
                            />
                          </li>
                        }
                        @for (
                          exampleIndex of exampleIndexesNewestFirst(worked.examples.length);
                          track exampleIndex
                        ) {
                          @let example = worked.examples[exampleIndex];
                          <li class="saved-example">
                            <div class="field-heading">
                              <span class="field-label">Example {{ exampleIndex + 1 }}</span>
                              <span class="header-actions">
                                <ng-container
                                  [ngTemplateOutlet]="exampleTranslateButton"
                                  [ngTemplateOutletContext]="{
                                    phrase: exampleFieldValue(workIndex, exampleIndex),
                                    raw: example.text,
                                    key: 'saved:' + workIndex + ':' + exampleIndex,
                                  }"
                                />
                                <ng-container
                                  [ngTemplateOutlet]="exampleWrench"
                                  [ngTemplateOutletContext]="{
                                    work: workIndex,
                                    kind: 'saved',
                                    index: exampleIndex,
                                  }"
                                />
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
                            <ng-container
                              [ngTemplateOutlet]="exampleField"
                              [ngTemplateOutletContext]="{
                                work: workIndex,
                                kind: 'saved',
                                index: exampleIndex,
                                phrase: exampleFieldValue(workIndex, exampleIndex),
                                raw: example.text,
                                label: 'Example ' + (exampleIndex + 1),
                                placeholder: '',
                              }"
                            />
                            @if (entries(example.metadata); as meta) {
                              @if (meta.length) {
                                <ul class="pills">
                                  @for (entry of meta; track entry.key) {
                                    @let color = metaColor('examples', entry.key);
                                    <li [class.colored]="color" [style.--meta-color]="color">
                                      <span>
                                        <span class="sense-meta-key">{{ label(entry.key) }}</span>
                                        <span class="sense-meta-value">{{
                                          label(entry.value)
                                        }}</span>
                                      </span>
                                    </li>
                                  }
                                </ul>
                              }
                            }
                          </li>
                        }
                      </ul>
                    }
                    @if (exampleError()) {
                      <p class="error">{{ exampleError() }}</p>
                    }
                  </section>
                }
                @if (current.kind === 'definition' && workTab() === 'forms') {
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
                @if (current.kind === 'example') {
                  <ng-container [ngTemplateOutlet]="editorFields" />
                }
              </div>
              @if (current.kind === 'definition') {
                <div class="sheet-actions sheet-footer">
                  @if (workTab() === 'definitions') {
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy() || aiBusy()"
                      (click)="askDeleteDefinition(current.index)"
                    >
                      Delete
                    </button>
                  }
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="workSaveDisabled()"
                    (click)="saveWork()"
                  >
                    @if (workTab() === 'definitions') {
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
                    [disabled]="
                      busy() || translating() || askingExamples() !== null || !draftGloss()
                    "
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
                          <span class="sense-meta-key">{{ label(entry.key) }}</span>
                          <span class="sense-meta-value">{{ label(entry.value) }}</span>
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
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-danger"
                  [disabled]="busy()"
                  (click)="askDeleteElement()"
                >
                  Delete
                </button>
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
              <p class="hint">{{ confirmHint(pending) }}</p>
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
      --swatch: var(--score-color);
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

    .title-main {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    .title-main h2 {
      display: flex;
      flex: 0 1 auto;
      min-width: 0;
      color: var(--text);
    }

    .element-title {
      min-width: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-align: start;
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-decoration-color: var(--text-muted);
      text-underline-offset: 0.16em;
      cursor: pointer;
    }

    .element-title.has-color {
      text-decoration-color: oklch(from var(--swatch) 0.74 calc(min(max(c, 0.16), 0.24)) h);
    }

    .element-title:hover:not(:disabled) {
      text-decoration-color: var(--text);
    }

    .element-title.has-color:hover:not(:disabled) {
      text-decoration-color: oklch(from var(--swatch) 0.84 calc(min(max(c, 0.16), 0.24)) h);
    }

    .element-title:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .element-edit {
      width: min(100%, 22rem);
    }

    .element-edit .sheet-actions .btn-danger {
      margin-right: auto;
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

    .lookup-float {
      position: fixed;
      z-index: 6;
      flex-wrap: nowrap;
      width: max-content;
      transform: translate(0.45rem, -50%);
      pointer-events: auto;
    }

    .lookup-float.before {
      transform: translate(calc(-100% - 0.45rem), -50%);
    }

    .lookup-float .lookup-chip {
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.32);
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

    .element-view {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .element-view.offstage {
      display: none;
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

    .example-slot-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      align-self: stretch;
      width: 2.2rem;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .example-slot-field.arrived .example-slot-clear {
      align-self: flex-start;
      width: 2.4rem;
      height: 2.4rem;
      border: 1px solid var(--border);
      border-radius: 0.7rem;
      background: var(--surface-2);
    }

    .example-slot-clear:hover:not(:disabled) {
      color: var(--text);
    }

    .example-slot-clear:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .example-slot-clear svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
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

    .sense-index {
      color: var(--text);
      font-size: 0.875rem;
      font-weight: 650;
      line-height: 1.2;
      white-space: nowrap;
    }

    .sense-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
    }

    .sense-row.actionable {
      cursor: pointer;
    }

    .sense-rail {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: none;
      margin-left: auto;
    }

    .sense-actions {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: none;
      gap: 0.05rem;
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

    .sense {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.875rem;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      border-radius: 1rem;
      background: var(--surface);
      -webkit-touch-callout: none;
    }

    .sense-body {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      width: 100%;
      min-width: 0;
    }

    .forms-region {
      cursor: pointer;
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

    .sense-meta li app-show-text {
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

    .sense-meta li.sense-equivalent app-show-text {
      color: var(--text);
    }

    .draft-field.square {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 0;
      background: var(--surface-2);
    }

    .draft-field.square textarea {
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .draft-translation {
      margin: 0.35rem 0 0;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-style: italic;
      line-height: 1.4;
    }

    .draft-field.square .draft-translation {
      display: flex;
      align-items: flex-start;
      gap: 0.35rem;
      margin: 0;
      padding: 0.55rem 0.75rem 0.7rem;
      border-top: 1px solid var(--border);
    }

    .draft-field.square .draft-translation > .line-edit {
      flex: 7 1 0;
      width: auto;
    }

    .draft-translation .line-edit {
      display: block;
      width: 100%;
      min-width: 0;
      flex: 1;
      height: auto;
      min-height: 1.4em;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: inherit;
      font-style: inherit;
      font-weight: inherit;
      line-height: inherit;
      field-sizing: content;
      resize: none;
      overflow: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .draft-translation .line-edit::placeholder {
      color: color-mix(in srgb, var(--text-muted) 72%, transparent);
      font-style: italic;
      font-weight: 400;
    }

    .draft-translation .line-edit:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .draft-translation .equivalent {
      display: flex;
      flex: 3 1 0;
      align-items: flex-start;
      min-width: 0;
      margin-left: 0.15em;
      color: var(--text);
      font-style: normal;
      font-weight: 600;
    }

    .draft-translation .equivalent::before {
      content: '·';
      margin-right: 0.4em;
      color: var(--text-muted);
      font-weight: 400;
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

    .saved-example .draft-translation {
      margin: 0;
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

    .examples-region .example-quote {
      padding: 0.75rem;
      border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--surface-2) 90%, transparent);
      color: #e2e8f0;
      font-size: 0.875rem;
      font-style: normal;
      font-weight: 500;
    }

    .examples-region .example-quote .passage {
      font-weight: 500;
    }

    .examples-region .example-quote .pills {
      font-style: normal;
      font-weight: 400;
    }

    .inline-pencil {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.05em;
      height: 1.05em;
      margin: 0 0 0 0.35em;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      vertical-align: -0.09em;
      cursor: pointer;
    }

    .inline-pencil svg {
      width: 0.9em;
      height: 0.9em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .inline-pencil:hover:not(:disabled) {
      color: var(--text);
    }

    .inline-pencil:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .example-cta {
      width: 100%;
      padding: 0.75rem;
      border: 1px dashed color-mix(in srgb, var(--border) 90%, transparent);
      border-radius: 0.75rem;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      text-align: start;
      cursor: pointer;
    }

    .example-cta:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--border);
    }

    .example-cta:disabled {
      cursor: default;
      opacity: 0.55;
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

    .sense > .group > .forms .form-chip.readonly.form-cta {
      border-style: dashed;
      background: transparent;
      color: var(--text-muted);
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
      display: flex;
      flex-direction: column;
      gap: 1.35rem;
    }

    .stats-summary,
    .stats-log {
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
    }

    .stats-log {
      gap: 0.7rem;
    }

    .stats-log .add-choices {
      gap: 0.85rem;
    }

    .stats-hero {
      display: flex;
      flex-direction: column;
      gap: 0.28rem;
      padding: 1rem 1.05rem 0.95rem;
      border: 1px solid color-mix(in srgb, var(--score-color) 48%, transparent);
      border-radius: 1.05rem;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--score-color) 24%, transparent),
        color-mix(in srgb, var(--score-color) 9%, rgba(8, 10, 18, 0.35))
      );
    }

    .stats-hero.unscored {
      --score-color: var(--text-muted);
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
      color: var(--score-color);
      font-size: 2.7rem;
      font-weight: 700;
      letter-spacing: -0.045em;
      line-height: 0.95;
    }

    .stats-hero-value .score-max {
      margin-left: 0.12rem;
      color: var(--text-muted);
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: 0;
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
      grid-template-columns: minmax(0, 1fr);
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
      stroke-width: 2;
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

    .editor-sheet > .sheet-head {
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

    .editor-sheet > .sheet-footer .btn-danger {
      margin-right: auto;
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

    .definition-ai .field-label,
    .definition-ai .forms-toggle,
    .definition-ai .hint {
      color: white;
    }

    .definition-ai textarea {
      border: 0;
      border-radius: 0.75rem;
      background: rgba(255, 255, 255, 0.16);
      color: white;
    }

    .definition-ai textarea::placeholder {
      color: rgba(255, 255, 255, 0.72);
    }

    .definition-ai .engineer-forms .equivalent-choices button {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.12);
      color: white;
    }

    .definition-ai .engineer-forms .equivalent-choices button.selected {
      background: white;
      color: var(--accent);
      border-color: white;
    }

    .definition-ai .grammar-picks {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definition-ai .grammar-picks button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.12rem;
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 0.75rem;
      background: rgba(255, 255, 255, 0.12);
      color: white;
      font: inherit;
      font-size: 0.8125rem;
      line-height: 1.35;
      text-align: left;
      padding: 0.45rem 0.65rem;
      cursor: pointer;
    }

    .definition-ai .grammar-picks button.selected {
      background: white;
      color: var(--accent);
      border-color: white;
    }

    .definition-ai .grammar-picks button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .definition-ai .grammar-change {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;
    }

    .definition-ai .grammar-picks .wrote {
      text-decoration: line-through;
      opacity: 0.75;
    }

    .definition-ai .example-actions .generate-main {
      background: white;
      color: var(--accent);
    }

    .definition-ai .example-actions .generate-main:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.86);
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

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid rgba(255, 92, 122, 0.55);
    }

    .btn-danger:hover:not(:disabled) {
      background: rgba(255, 92, 122, 0.12);
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

    .gem-gain {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      flex: none;
    }

    .score-readout[data-gem='red'],
    .gem-gain[data-gem='red'] {
      --exercise-gem: var(--gem-red);
    }

    .score-readout[data-gem='orange'],
    .gem-gain[data-gem='orange'] {
      --exercise-gem: var(--gem-orange);
    }

    .score-readout[data-gem='green'],
    .gem-gain[data-gem='green'] {
      --exercise-gem: var(--gem-green);
    }

    .gem-gain-stone {
      --gem-size: 0.85rem;
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
      align-items: flex-start;
      gap: 0.1rem;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .log-row > .icon-btn {
      margin-top: -0.22rem;
    }

    .log-row > .score-readout {
      margin-top: 0.02rem;
    }

    .log-row > .gem-gain {
      margin-top: 0.28rem;
    }

    .log-open {
      display: flex;
      flex: 1 1 auto;
      align-items: flex-start;
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
      align-items: flex-start;
      gap: 0.85rem;
      padding: 0.75rem 0.85rem 0.9rem;
      border-top: 1px solid var(--border);
    }

    .log-detail.feedback-note {
      padding-left: calc(0.7rem + 0.95rem + 0.4rem);
    }

    .log-versions {
      align-items: stretch;
      gap: 1.15rem;
    }

    .log-version {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.55rem;
      box-sizing: border-box;
      min-width: 0;
      padding: 0.7rem 0.75rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.035);
    }

    .log-detail-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      align-self: stretch;
      gap: 0.75rem;
    }

    .log-translation {
      align-self: stretch;
      margin: 0;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .log-detail .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .log-row .log-copy {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.12rem;
      min-width: 0;
    }

    .log-row .log-game {
      display: block;
      max-width: 100%;
      overflow: hidden;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .log-edit-line {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      max-width: 100%;
      min-width: 0;
    }

    .log-open .log-edit-line {
      flex: 1 1 auto;
    }

    .log-open > .log-chevron {
      margin-top: 0.12rem;
    }

    .log-edit-copies {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.28rem;
      min-width: 0;
    }

    .log-wrench {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      margin-top: 0.1rem;
      color: var(--text-muted);
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .log-change {
      max-width: 100%;
      font-weight: 650;
      line-height: 1.3;
      white-space: normal;
    }

    .log-mark {
      display: block;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 550;
      line-height: 1.2;
    }

    .log-feedback {
      align-self: stretch;
      margin: 0;
      font-weight: 500;
      line-height: 1.4;
      white-space: normal;
    }

    .history-empty {
      margin: 0.35rem 0 0;
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

    .score-readout.score-plain {
      gap: 0.12rem;
    }

    .score-input {
      width: 2.6rem;
      margin: 0;
      padding: 0.1rem 0.15rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 700;
      text-align: center;
      appearance: textfield;
    }

    .score-input::-webkit-outer-spin-button,
    .score-input::-webkit-inner-spin-button {
      margin: 0;
      appearance: none;
    }

    .score-input:focus {
      outline: none;
      border-color: var(--accent-border);
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

    .sheet-head:has(.work-tabs) {
      flex-wrap: wrap;
    }

    .lang.work-tabs {
      display: flex;
      align-self: stretch;
      flex: 1 1 16rem;
      box-sizing: border-box;
      width: auto;
      min-width: 0;
      padding-inline: 0;
    }

    .sheet-head:has(.work-tabs) .sheet-tools {
      margin-left: auto;
    }

    .lang.work-tabs button {
      flex: 1 1 0;
      min-width: 0;
      text-align: center;
      padding-inline: 0.55rem;
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
  readonly canGoBack = input(false);
  /** Sense to scroll into view when this element opens. It stays collapsed. */
  readonly definitionIndex = input(0);
  /** Example sentence carried in from the element that opened this one. */
  readonly arrivedExample = input('');
  /** This open is the one that created the element, so recall stays out of the way. */
  readonly skipRecall = input(false);
  /** Parent headword and gloss, shown so an example can be written before it is added. */
  readonly arrivedGuide = input('');
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly deleted = output<void>();
  readonly visit = output<{ id: string; definition: number; example: string; guide: string }>();
  readonly back = output<void>();
  readonly addSelection = output<{
    title: string;
    language: string;
    definition: number;
    example: string;
    guide: string;
    done: (saved: boolean) => void;
  }>();
  readonly addPrepared = output<PreparedElement>();

  readonly supportAvailable = computed(() => this.translationTarget() !== '');

  labeledTranslation(translation: { text: string }): string {
    return translation.text.trim();
  }

  labeledEquivalent(text: string): string {
    return text.trim();
  }

  private alive = true;
  readonly formMaxLength = FORM_MAX_LENGTH;
  readonly metaKeyMaxLength = META_KEY_MAX_LENGTH;
  readonly metaValueMaxLength = META_VALUE_MAX_LENGTH;
  readonly exampleInstructionMax = MAX_EXAMPLE_INSTRUCTION;
  readonly exampleLengthMax = MAX_EXAMPLE_LENGTH;
  readonly equivalentMax = EQUIVALENT_MAX;
  readonly definitionInstructionMax = MAX_DEFINITION_INSTRUCTION;
  readonly relatedPickMax = MAX_RELATED_PICKS;
  readonly parsePassage = parsePassage;
  readonly editor = signal<Editor | null>(null);
  /** Section shown in the definition work sheet. */
  readonly workTab = signal<WorkTab>('definitions');
  readonly textDraft = signal('');
  /** Translation shown for the current draft phrase. Hidden once that phrase changes. */
  readonly draftTranslation = signal<{ phrase: string; text: string } | null>(null);
  /** Translation text being typed for the definition or single example draft. */
  private readonly translationEdit = signal<{ phrase: string; text: string } | null>(null);
  /** Phrase whose translation the user cleared, so an embedded copy does not return. */
  private readonly translationCleared = signal('');
  /** Equivalent text being typed. Null when the field shows the stored gloss. */
  private readonly equivalentEdit = signal<string | null>(null);
  private readonly exampleTranslationEdit = signal<{ phrase: string; text: string } | null>(null);
  private readonly exampleTranslationCleared = signal('');
  readonly translating = signal(false);
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
  private collisionWord = '';
  readonly passageSelection = signal<PassageSelection | null>(null);
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly shownDefinitions = computed(() => this.element().definitions);
  /** The recall for this open has been submitted or given up. */
  readonly recallSettled = signal(false);
  readonly recallSkipped = computed(() => this.skipRecall());
  readonly recallPending = computed(
    () => this.element().definitions.length > 0 && !this.recallSkipped() && !this.recallSettled(),
  );
  readonly recallSenses = computed((): RecallSense[] => {
    const target = this.translationTarget();
    const element = this.element();
    return element.definitions.flatMap((definition) => {
      const gloss = parsePassage(definition.text).text.trim();
      if (!gloss) return [];
      const equivalent = target
        ? equivalentTextFor(element.equivalents, definition.equivalentIds, target)
        : '';
      return [equivalent ? { gloss, equivalent } : { gloss }];
    });
  });
  readonly recallExamples = computed(() => {
    const sentences: { text: string; definition: number }[] = [];
    this.element().definitions.forEach((definition, index) => {
      for (const example of definition.examples) {
        const text = parsePassage(example.text).text.trim();
        if (text) sentences.push({ text, definition: index + 1 });
      }
    });
    return sentences;
  });
  /** Per-sense unveil stage. Missing means the sense is still closed. */
  readonly senseStages = signal<ReadonlyMap<number, SenseStage>>(new Map());
  readonly asking = signal(false);
  readonly addingSelection = signal(false);
  readonly titleEdit = signal(false);
  readonly titleDraft = signal('');
  readonly titleError = signal('');
  readonly addingDefinitions = signal<'example' | null>(null);
  readonly definitionExample = signal('');
  /** Arrived example shown as text until it is placed. */
  readonly heldExample = signal('');
  readonly askingForms = signal<number | null>(null);
  readonly askingExamples = signal<number | null>(null);
  readonly formAttributesView = signal<ElementForm | null>(null);
  /** Generated example waiting to be saved. */
  readonly exampleDraft = signal<ExampleDraft | null>(null);
  /** Editing text for the generated example, when it differs from the stored sentence. */
  readonly exampleDraftField = signal<{ definitionIndex: number; text: string } | null>(null);
  /** Unsaved text for examples already on a definition, keyed by definition and example index. */
  readonly exampleEdits = signal<ReadonlyMap<string, string>>(new Map());
  /** Blank example rows added in the sheet, newest first. */
  readonly exampleAdditions = signal<ReadonlyMap<number, string[]>>(new Map());
  /** Generated forms waiting to be saved. */
  readonly pendingForms = signal<PendingForms | null>(null);
  readonly exampleError = signal('');
  readonly formsError = signal('');
  /** Which listed example is waiting on a translation. */
  readonly translatingExample = signal<string | null>(null);
  private readonly exampleTranslationVersion = signal(0);
  readonly askingRelated = signal<number | null>(null);
  readonly askingWording = signal<number | null>(null);
  readonly newGlosses = signal<ReadonlySet<string>>(new Set());
  readonly exampleSuggestions = signal<Record<string, ExampleSuggestion[]>>({});
  readonly exampleEngineer = signal<ExampleEngineer | null>(null);
  readonly grammarChoices = signal<GrammarMistake[]>([]);
  /** Instruction panel open on one example row in the work sheet. */
  readonly exampleFieldEngineer = signal<ExampleFieldEngineer | null>(null);
  readonly definitionEngineer = signal<DefinitionEngineer | null>(null);
  readonly historyOpen = signal(false);
  readonly exerciseEntry = signal(-1);
  readonly error = signal('');
  readonly speaking = signal<string | null>(null);

  /** Latest element written from this card, including a save that has not finished. */
  private written: StoredElement | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private busySaves = 0;
  private translateTicket = 0;
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
  private readonly definitionBody = viewChild<ElementRef<HTMLElement>>('definitionBody');
  private readonly editorSheet = viewChild<ElementRef<HTMLElement>>('editorSheet');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      stopSpeaking();
    });
    effect(() => {
      const id = this.element().id;
      if (id === this.trackedElementId) return;
      const definition = this.definitionIndex();
      this.trackedElementId = id;
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
      this.translatingExample.set(null);
      this.askingExamples.set(null);
      this.askingRelated.set(null);
      this.askingWording.set(null);
      this.exampleEngineer.set(null);
      this.exampleFieldEngineer.set(null);
      this.grammarChoices.set([]);
      this.definitionEngineer.set(null);
      this.senseStages.set(new Map());
      this.recallSettled.set(false);
      this.draftTranslation.set(null);
      this.translationEdit.set(null);
      this.translationCleared.set('');
      this.equivalentEdit.set(null);
      this.exampleTranslationEdit.set(null);
      this.exampleTranslationCleared.set('');
      this.historyOpen.set(false);
      this.exerciseEntry.set(-1);
      const arrived = this.arrivedExample().trim().slice(0, MAX_EXAMPLE_LENGTH);
      this.definitionExample.set(arrived);
      this.heldExample.set(arrived);
      this.formAttributesView.set(null);
      this.addingDefinitions.set(null);
      this.askingMetadata.set(false);
      this.engineerDrafts.clear();
      this.definitionEngineerDrafts = readRelatedDrafts(id);
      void this.commitStoredExamples(id);
      this.refreshNewDefinitions(id);
      this.scrollSenseIntoView(definition);
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
    document.addEventListener('scroll', this.syncPassageSelection, true);
    window.addEventListener('resize', this.syncPassageSelection);
    inject(DestroyRef).onDestroy(() => {
      stopWatchingExamples();
      document.removeEventListener('selectionchange', this.syncPassageSelection);
      document.removeEventListener('pointerdown', this.onSelectionPointerDown, true);
      document.removeEventListener('pointerup', this.syncPassageSelection, true);
      document.removeEventListener('scroll', this.syncPassageSelection, true);
      window.removeEventListener('resize', this.syncPassageSelection);
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm()?.kind === 'exercise') {
      if (!this.busy()) this.confirm.set(null);
      return;
    }
    if (this.confirm()) {
      this.confirm.set(null);
      return;
    }
    if (this.titleEdit()) {
      if (!this.busy()) this.cancelTitle();
      return;
    }
    if (this.historyOpen()) {
      if (this.exerciseEntry() >= 0) this.exerciseEntry.set(-1);
      else this.closeExerciseLog();
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
    else this.closeEditor();
  }

  openTitle(): void {
    if (this.aiBusy() || this.titleEdit()) return;
    this.titleError.set('');
    this.titleDraft.set(this.element().title);
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
    return this.titleChanged();
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
    const saved = await this.commit({ ...current, title: name, definitions }, { report: false });
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

  examplePlaceholder(): string {
    const language = languageDisplayName(this.element().language);
    return language ? `Enter your own example in ${language}…` : 'Enter your own example…';
  }

  translationLanguageName(): string {
    const code = this.translationTarget();
    return code ? languageDisplayName(code) : '';
  }

  translationTarget(): string {
    return supportLanguageFor(this.element().language);
  }

  finishRecall(result: RecallFinish): void {
    if (this.recallSettled()) return;
    const element = this.currentElement();
    if (!element.definitions.length) return;
    const glosses = element.definitions
      .map((definition) => parsePassage(definition.text).text.trim())
      .filter(Boolean);
    const entry: DefinitionGameLog = {
      event: 'game',
      game: 'definition',
      score: result.score,
      by: result.by,
      at: Date.now(),
      answer: result.answer,
      ...(result.explanation ? { explanation: result.explanation } : {}),
      ...(result.extra ? { extra: true } : {}),
      ...(glosses.length ? { snapshot: { text: glosses.join('\n'), equivalent: '' } } : {}),
    };
    const gem = attributeGem(element.log, entry);
    if (gem) entry.gem = gem;
    this.appendLog(entry);
    this.revealRecallDefinitions(element);
    this.recallSettled.set(true);
    void this.persist(this.copyDefinitions(), this.currentElement().equivalents, { busy: false });
  }

  acceptRecallExtra(extra: RecallExtra): void {
    const element = this.currentElement();
    void this.commitGeneratedSenses(
      element,
      [
        {
          text: extra.gloss,
          metadata: {},
          ...(extra.example ? { example: extra.example } : {}),
          ...(extra.equivalent ? { equivalent: extra.equivalent } : {}),
        },
      ],
      'end',
    ).then((saved) => {
      if (!saved || this.element().id !== element.id) return;
      const index = this.currentElement().definitions.length - 1;
      this.senseStages.update((current) => {
        const next = new Map(current);
        next.set(index, 'open');
        return next;
      });
    });
  }

  private revealRecallDefinitions(element: StoredElement): void {
    const stages = new Map<number, SenseStage>();
    for (let index = 0; index < element.definitions.length; index += 1) {
      stages.set(index, 'open');
    }
    this.senseStages.set(stages);
  }

  /** Equivalent linked to the definition open in this sheet. */
  sheetEquivalent(): string {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return '';
    const element = this.currentElement();
    const definition = element.definitions[editor.index];
    if (!definition) return '';
    return equivalentTextFor(
      element.equivalents,
      definition.equivalentIds,
      this.translationTarget(),
    );
  }

  canAskMetadata(): boolean {
    const editor = this.editor();
    return (
      !!editor &&
      this.draftGloss().length > 0 &&
      !this.askingMetadata() &&
      !this.aiBusy() &&
      !this.translating()
    );
  }

  async askMetadata(): Promise<void> {
    const editor = this.editor();
    if (!editor || (editor.kind !== 'definition' && editor.kind !== 'example')) return;
    if (!this.canAskMetadata()) return;
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

  senseStage(index: number): SenseStage | 'closed' {
    if (this.recallSkipped()) return 'open';
    return this.senseStages().get(index) ?? 'closed';
  }

  onSenseClick(event: Event, index: number): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, textarea, select')) return;
    if (!target.closest('.sense-row')) return;
    this.unveilFromRow(event, index);
  }

  /** A click on the definition row takes the next step. The icon buttons do that themselves. */
  unveilFromRow(event: Event, index: number): void {
    const target = event.target;
    if (target instanceof Element && target.closest('button, a')) return;
    if (this.senseStage(index) === 'closed') this.unveilExamples(index);
    else this.unveilDefinitionText(index);
  }

  /** First click on a closed sense. Examples stay without translations. */
  unveilExamples(index: number): void {
    if (this.senseStage(index) !== 'closed') return;
    this.senseStages.update((current) => {
      const next = new Map(current);
      next.set(index, 'examples');
      return next;
    });
  }

  /** Second click. The definition text appears, and translations can be unveiled. */
  unveilDefinitionText(index: number): void {
    if (this.senseStage(index) !== 'examples') return;
    this.senseStages.update((current) => {
      const next = new Map(current);
      next.set(index, 'open');
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

  sheetTitle(editor: Editor): string {
    if (editor.kind === 'definition') return 'Definition';
    return editor.exampleIndex == null ? 'Add an example' : 'Edit example';
  }

  workSectionLabel(editor: Editor): string {
    if (editor.kind !== 'definition') return 'Definition';
    if (this.workTab() === 'examples') return 'Examples';
    if (this.workTab() === 'forms') return 'Forms';
    return 'Definition';
  }

  workSaveDisabled(): boolean {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return true;
    if (this.workTab() === 'examples') {
      return this.busy() || this.askingExamples() !== null || !this.examplesDirty(editor.index);
    }
    if (this.workTab() === 'forms') {
      const pending = this.pendingForms();
      return (
        this.busy() ||
        this.askingForms() !== null ||
        pending?.definitionIndex !== editor.index ||
        !pending.forms.length
      );
    }
    return this.busy() || this.asking() || this.translating() || !this.draftGloss();
  }

  workCloseDisabled(): boolean {
    return (
      this.busy() ||
      this.asking() ||
      this.definitionSheetBusy() ||
      this.askingExamples() !== null ||
      this.askingForms() !== null
    );
  }

  saveWork(): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition' || this.workSaveDisabled()) return;
    if (this.workTab() === 'examples') {
      void this.saveExampleEdits();
      return;
    }
    if (this.workTab() === 'forms') {
      void this.savePendingForms();
      return;
    }
    void this.saveEditor();
  }

  /** Saved definition, including edits that have not reached the parent yet. */
  sheetDefinition(index: number): ElementDefinition | null {
    return this.currentElement().definitions[index] ?? null;
  }

  closeEditor(): void {
    const editor = this.editor();
    if (!editor) return;
    if (
      this.asking() ||
      this.definitionSheetBusy() ||
      this.askingExamples() !== null ||
      this.askingForms() !== null
    ) {
      return;
    }
    if (editor.kind === 'example') {
      this.openExamples(editor.definitionIndex);
      return;
    }
    this.editor.set(null);
    this.workTab.set('definitions');
    this.definitionEngineer.set(null);
    this.exampleEngineer.set(null);
    this.exampleFieldEngineer.set(null);
    this.exampleDraft.set(null);
    this.exampleDraftField.set(null);
    this.exampleEdits.set(new Map());
    this.exampleAdditions.set(new Map());
    this.pendingForms.set(null);
    this.exampleError.set('');
    this.formsError.set('');
  }

  closeEditorSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.closeEditor();
  }

  /** Examples and forms are available on the definition that is open. */
  canOpenWorkSection(): boolean {
    return this.editor()?.kind === 'definition';
  }

  showWorkTab(tab: WorkTab): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return;
    this.workTab.set(tab);
    this.scrollWorkSheet();
  }

  private scrollWorkSheet(): void {
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
      this.askingWording() !== null
    );
  }

  generateExample(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.openExampleEngineer(index);
  }

  generateForms(index: number): void {
    if (this.aiBusy() || !this.sheetDefinition(index)) return;
    void this.askForms(index);
  }

  addFormManually(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.openForm(index);
  }

  addExampleManually(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.exampleAdditions.update((current) => {
      const next = new Map(current);
      next.set(index, ['', ...(next.get(index) ?? [])]);
      return next;
    });
    this.exampleError.set('');
    setTimeout(() => {
      this.editorSheet()
        ?.nativeElement.querySelector<HTMLTextAreaElement>('.example-addition')
        ?.focus();
    });
  }

  submitDefinitionExample(event: Event): void {
    event.preventDefault();
    if (!this.definitionExample().trim() && this.arrivedGuide()) {
      void this.createGuidedExample();
      return;
    }
    void this.addDefinitionFromExample();
  }

  guidedExample(): boolean {
    return !!this.arrivedGuide() && !this.definitionExample().trim();
  }

  clearExampleSlot(): void {
    if (this.aiBusy()) return;
    this.definitionExample.set('');
    this.heldExample.set('');
  }

  private async createGuidedExample(): Promise<void> {
    if (this.aiBusy()) return;
    const guide = splitExampleGuide(this.arrivedGuide());
    const element = this.element();
    const selected = element.title.replace(/\s+/g, ' ').trim();
    if (!guide || !selected) return;
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      return;
    }
    this.addingDefinitions.set('example');
    this.asking.set(true);
    this.error.set('');
    try {
      const sentence = await generateDerivedExample({
        language: element.language,
        root: guide.root,
        definition: guide.gloss,
        selected,
        translation: this.translationTarget(),
      });
      if (this.element().id !== element.id) return;
      if (!sentence) {
        this.error.set('Could not write that example.');
        return;
      }
      this.definitionExample.set(sentence);
      this.heldExample.set(sentence);
    } catch {
      if (this.element().id === element.id) this.error.set('Could not write that example.');
    } finally {
      if (this.element().id === element.id) {
        this.asking.set(false);
        this.addingDefinitions.set(null);
      }
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
    if (this.element().id === element.id) this.scrollSenseIntoView(index);
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
    }));
    const existing = this.copyDefinitions();
    const next = placement === 'end' ? [...existing, ...created] : [...created, ...existing];
    if (!(await this.persist(next, attached.equivalents))) return false;
    const glosses = created.map((definition) => definitionGloss(definition.text)).filter(Boolean);
    rememberNewDefinitions(element.id, glosses);
    if (this.element().id === element.id) {
      if (placement === 'start') this.shiftDefinitionIndexes(created.length);
      this.formAttributesView.set(null);
      const index = placement === 'end' ? next.length - 1 : 0;
      this.scrollSenseIntoView(index);
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
    if (editor?.kind === 'definition') {
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
    this.shiftExampleEditDefinitions(by);
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
    this.shiftSenseState(by);
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

  private scrollSenseIntoView(index: number): void {
    const elementId = this.element().id;
    const run = (attempt: number) => {
      if (!this.alive || this.element().id !== elementId) return;
      const body = this.definitionBody()?.nativeElement;
      const sense = body?.querySelector(`#sense-${index}`);
      if (sense instanceof HTMLElement) {
        sense.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (attempt < 2) requestAnimationFrame(() => run(attempt + 1));
    };
    requestAnimationFrame(() => run(0));
  }

  private shiftSenseState(by: number): void {
    this.senseStages.update((current) => shiftIndexMap(current, by));
  }

  private dropSenseState(index: number): void {
    this.senseStages.update((current) => dropIndexMap(current, index));
  }

  openDefinition(index: number): void {
    const current = this.editor();
    if (current?.kind === 'definition' && current.index === index) {
      this.showWorkTab('definitions');
      return;
    }
    const definition = this.sheetDefinition(index) ?? this.element().definitions[index];
    if (!definition) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.metaKey.set('');
    this.metaValue.set('');
    this.exampleEngineer.set(null);
    this.exampleFieldEngineer.set(null);
    this.definitionEngineer.set(null);
    this.exampleError.set('');
    this.formsError.set('');
    if (this.exampleDraft()?.definitionIndex !== index) this.exampleDraft.set(null);
    if (this.pendingForms()?.definitionIndex !== index) this.pendingForms.set(null);
    this.sheetMetadata.set({ ...definition.metadata });
    this.beginSheet(definition.text);
    this.dismissNew(definition.text);
    this.editor.set({ kind: 'definition', index });
    this.workTab.set('definitions');
    this.showStoredDraftTranslation();
  }

  /** Open the work sheet on Examples or Forms without leaving this definition. */
  private openWorkTab(index: number, tab: Exclude<WorkTab, 'definitions'>): void {
    const editor = this.editor();
    if (editor?.kind === 'definition' && editor.index === index) {
      this.showWorkTab(tab);
      return;
    }
    this.openDefinition(index);
    const opened = this.editor();
    if (opened?.kind === 'definition' && opened.index === index) this.workTab.set(tab);
  }

  onFormsClick(event: MouseEvent, index: number): void {
    if (this.aiBusy()) return;
    if (this.ignoredSheetClick(event, 'button, a, input, textarea')) return;
    this.openForms(index);
  }

  private ignoredSheetClick(event: MouseEvent, selector: string): boolean {
    const target = event.target;
    return !(target instanceof Element) || !!target.closest(selector);
  }

  openExamples(index: number): void {
    if (!this.element().definitions[index]) return;
    this.openWorkTab(index, 'examples');
  }

  openForms(index: number): void {
    if (this.aiBusy() || !this.element().definitions[index]) return;
    this.openWorkTab(index, 'forms');
  }

  openExample(definitionIndex: number, exampleIndex: number | null): void {
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
      grammarOpen: false,
      grammarId: '',
    });
    void this.loadGrammarChoices();
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
      grammarOpen: false,
      grammarId: '',
    });
    void this.loadGrammarChoices();
  }

  closeExampleEngineer(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    if (this.askingExamples() !== null) return;
    this.exampleEngineer.set(null);
  }

  exampleEngineerOpen(): boolean {
    const editor = this.editor();
    const engineer = this.exampleEngineer();
    return (
      editor?.kind === 'example' &&
      editor.exampleIndex == null &&
      engineer?.definitionIndex === editor.definitionIndex
    );
  }

  toggleExampleEngineer(): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'example' || editor.exampleIndex != null) return;
    if (this.exampleEngineerOpen()) {
      if (this.askingExamples() !== null) return;
      this.exampleEngineer.set(null);
      return;
    }
    if (this.aiBusy()) return;
    this.exampleError.set('');
    this.ensureExampleEngineer(editor.definitionIndex);
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
    return editor?.kind === 'definition' && engineer?.definitionIndex === editor.index;
  }

  toggleDefinitionEngineer(): void {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return;
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
    return joinPhrase(plainPassage(this.textDraft()), extra.text);
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
      this.textDraft.set(this.appendedEngineerPassage(extra));
    } catch {
      if (this.element().id === element.id) this.sheetError.set('Could not forge a definition.');
    } finally {
      if (this.wordingJob === job && this.element().id === element.id) this.askingWording.set(null);
    }
  }

  grammarPickerOpen(surface: GrammarSurface): boolean {
    return surface === 'new'
      ? !!this.exampleEngineer()?.grammarOpen
      : !!this.exampleFieldEngineer()?.grammarOpen;
  }

  grammarPickerLabel(surface: GrammarSurface): string {
    const id =
      surface === 'new'
        ? this.exampleEngineer()?.grammarId
        : this.exampleFieldEngineer()?.grammarId;
    const mistake = this.grammarTarget(id ?? '');
    return mistake?.rule ?? '';
  }

  grammarMistakeChosen(surface: GrammarSurface, id: string): boolean {
    const current =
      surface === 'new'
        ? this.exampleEngineer()?.grammarId
        : this.exampleFieldEngineer()?.grammarId;
    return current === id;
  }

  toggleGrammarPicker(surface: GrammarSurface): void {
    if (this.askingExamples() !== null) return;
    if (surface === 'new') {
      const engineer = this.exampleEngineer();
      if (!engineer) return;
      const grammarOpen = !engineer.grammarOpen;
      this.exampleEngineer.set({ ...engineer, grammarOpen });
      if (grammarOpen) void this.loadGrammarChoices();
      return;
    }
    const engineer = this.exampleFieldEngineer();
    if (!engineer) return;
    const grammarOpen = !engineer.grammarOpen;
    this.exampleFieldEngineer.set({ ...engineer, grammarOpen });
    if (grammarOpen) void this.loadGrammarChoices();
  }

  pickGrammarMistake(surface: GrammarSurface, id: string): void {
    if (this.askingExamples() !== null) return;
    if (surface === 'new') {
      const engineer = this.exampleEngineer();
      if (!engineer) return;
      this.exampleEngineer.set({
        ...engineer,
        grammarId: engineer.grammarId === id ? '' : id,
      });
      return;
    }
    const engineer = this.exampleFieldEngineer();
    if (!engineer) return;
    this.exampleFieldEngineer.set({
      ...engineer,
      grammarId: engineer.grammarId === id ? '' : id,
    });
  }

  private grammarTarget(id: string): GrammarMistake | undefined {
    const key = id.trim();
    if (!key) return undefined;
    return this.grammarChoices().find((mistake) => mistake.id === key);
  }

  private grammarRequest(id: string): { grammarMistake?: { rule: string } } {
    const mistake = this.grammarTarget(id);
    return mistake ? { grammarMistake: { rule: mistake.rule } } : {};
  }

  private grammarChoicesTicket = 0;

  private async loadGrammarChoices(): Promise<void> {
    const language = this.element().language;
    const ticket = ++this.grammarChoicesTicket;
    try {
      const rows = await readOpenGrammarMistakes(language);
      if (ticket !== this.grammarChoicesTicket || this.element().language !== language) return;
      this.grammarChoices.set(rows);
    } catch {
      if (ticket === this.grammarChoicesTicket && this.element().language === language) {
        this.grammarChoices.set([]);
      }
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
    const index = engineer.definitionIndex;
    const editor = this.editor();
    const editing =
      editor?.kind === 'example' && editor.definitionIndex === index && editor.exampleIndex == null
        ? this.draftGloss()
        : '';
    const held = this.exampleDraftFor(index);
    const job = ++this.exampleJob;
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
          ...(editing ? [editing] : []),
          ...(held ? [parsePassage(held.text).text] : []),
        ],
        forms: required ? [] : definition.forms.map((form) => form.text),
        exampleWords: [],
        exampleInstruction: engineer.instruction,
        ...(required ? { requiredForm: required } : {}),
        ...this.grammarRequest(engineer.grammarId),
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
        (held && senseKey(held.text) === sentenceKey) ||
        (editing && senseKey(editing) === sentenceKey)
      ) {
        this.exampleError.set('No further examples.');
        return;
      }
      if (
        editor?.kind === 'example' &&
        editor.definitionIndex === index &&
        editor.exampleIndex == null
      ) {
        this.sheetMetadata.set({ ...sentence.metadata });
        this.textDraft.set(plainPassage(sentence.text));
        return;
      }
      this.exampleDraftField.set(null);
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

  exampleAdditionIndexes(index: number): number[] {
    return (this.exampleAdditions().get(index) ?? []).map((_, additionIndex) => additionIndex);
  }

  exampleAdditionValue(definitionIndex: number, additionIndex: number): string {
    return this.exampleAdditions().get(definitionIndex)?.[additionIndex] ?? '';
  }

  onExampleAddition(definitionIndex: number, additionIndex: number, event: Event): void {
    const value = this.inputValue(event);
    this.exampleAdditions.update((current) => {
      const rows = [...(current.get(definitionIndex) ?? [])];
      if (additionIndex >= rows.length) return current;
      rows[additionIndex] = value;
      const next = new Map(current);
      next.set(definitionIndex, rows);
      return next;
    });
  }

  removeExampleAddition(definitionIndex: number, additionIndex: number): void {
    if (this.aiBusy()) return;
    const engineer = this.exampleFieldEngineer();
    if (
      engineer?.definitionIndex === definitionIndex &&
      engineer.kind === 'addition' &&
      engineer.index === additionIndex
    ) {
      this.exampleFieldEngineer.set(null);
    } else if (
      engineer?.definitionIndex === definitionIndex &&
      engineer.kind === 'addition' &&
      engineer.index != null &&
      engineer.index > additionIndex
    ) {
      this.exampleFieldEngineer.set({ ...engineer, index: engineer.index - 1 });
    }
    this.exampleAdditions.update((current) => {
      const rows = [...(current.get(definitionIndex) ?? [])];
      rows.splice(additionIndex, 1);
      const next = new Map(current);
      if (rows.length) next.set(definitionIndex, rows);
      else next.delete(definitionIndex);
      return next;
    });
  }

  exampleFieldValue(definitionIndex: number, exampleIndex: number): string {
    const edited = this.exampleEdits().get(this.exampleEditKey(definitionIndex, exampleIndex));
    if (edited != null) return edited;
    const example = this.sheetDefinition(definitionIndex)?.examples[exampleIndex];
    return plainPassage(example?.text ?? '');
  }

  /** Stored translation for this example wording, the same way a definition draft shows one. */
  listedExampleTranslation(phrase: string): string {
    this.exampleTranslationVersion();
    const text = plainPassage(phrase).trim();
    if (!text || !this.supportAvailable()) return '';
    const cached =
      readPhraseTranslation(this.element().language, this.translationTarget(), text)?.text.trim() ??
      '';
    if (cached) return cached;
    return '';
  }

  /** Translation shown under an example, including an unsaved edit or a clear. */
  exampleTranslationField(phrase: string): string {
    const text = plainPassage(phrase).trim();
    const edit = this.exampleTranslationEdit();
    if (edit?.phrase === text) return edit.text;
    if (text && this.exampleTranslationCleared() === text) return '';
    return this.listedExampleTranslation(phrase);
  }

  onExampleTranslationInput(phrase: string, event: Event): void {
    const text = plainPassage(phrase).trim();
    if (!text) return;
    this.exampleTranslationEdit.set({ phrase: text, text: this.inputValue(event) });
  }

  commitExampleTranslation(phrase: string): void {
    const text = plainPassage(phrase).trim();
    const edit = this.exampleTranslationEdit();
    if (!text || !edit || edit.phrase !== text) return;
    const next = edit.text.trim();
    this.exampleTranslationEdit.set(null);
    const current = this.listedExampleTranslation(phrase).trim();
    if (next === current && this.exampleTranslationCleared() !== text) return;
    replacePhraseTranslation(this.element().language, this.translationTarget(), text, next);
    this.exampleTranslationCleared.set(next ? '' : text);
    this.exampleTranslationVersion.update((version) => version + 1);
  }

  canTranslateListedExample(phrase: string, key: string): boolean {
    return (
      this.supportAvailable() &&
      !!plainPassage(phrase).trim() &&
      !this.exampleTranslationField(phrase).trim() &&
      this.translatingExample() !== key &&
      !this.aiBusy() &&
      !this.translating()
    );
  }

  async translateListedExample(phrase: string, key: string): Promise<void> {
    const text = plainPassage(phrase).trim();
    if (!this.canTranslateListedExample(phrase, key)) return;
    if (!readStoredAiCredentials().keys.length) {
      this.exampleError.set('Save an API key first.');
      return;
    }
    this.translatingExample.set(key);
    this.exampleError.set('');
    try {
      await requestPhraseTranslation(this.element().language, this.translationTarget(), text);
      if (this.exampleTranslationCleared() === text) this.exampleTranslationCleared.set('');
      this.exampleTranslationVersion.update((version) => version + 1);
    } catch {
      this.exampleError.set('Could not translate this.');
    } finally {
      if (this.translatingExample() === key) this.translatingExample.set(null);
    }
  }

  exampleFieldOpen(definitionIndex: number, kind: ExampleFieldKind, index: number | null): boolean {
    const engineer = this.exampleFieldEngineer();
    return (
      !!engineer &&
      engineer.definitionIndex === definitionIndex &&
      engineer.kind === kind &&
      (kind === 'draft' || engineer.index === index)
    );
  }

  exampleFieldBusy(definitionIndex: number, kind: ExampleFieldKind, index: number | null): boolean {
    return (
      this.askingExamples() === definitionIndex &&
      this.exampleFieldOpen(definitionIndex, kind, index)
    );
  }

  exampleFieldPrompt(phrase: string): string {
    return phrase.trim()
      ? 'Instruct AI on how to modify this example'
      : 'Instruct AI on how to write this example';
  }

  exampleFieldGenerateDisabled(): boolean {
    const engineer = this.exampleFieldEngineer();
    const grammar = engineer ? this.grammarTarget(engineer.grammarId) : undefined;
    return this.askingExamples() !== null || (!engineer?.instruction.trim() && !grammar);
  }

  toggleExampleField(definitionIndex: number, kind: ExampleFieldKind, index: number | null): void {
    if (this.exampleFieldOpen(definitionIndex, kind, index)) {
      if (this.askingExamples() !== null) return;
      this.exampleFieldEngineer.set(null);
      return;
    }
    if (this.aiBusy()) return;
    this.exampleError.set('');
    this.exampleFieldEngineer.set({
      definitionIndex,
      kind,
      index,
      instruction: '',
      grammarOpen: false,
      grammarId: '',
    });
    void this.loadGrammarChoices();
  }

  onExampleFieldInstruction(event: Event): void {
    const engineer = this.exampleFieldEngineer();
    if (!engineer) return;
    this.exampleFieldEngineer.set({
      ...engineer,
      instruction: this.inputValue(event).slice(0, MAX_EXAMPLE_INSTRUCTION),
    });
  }

  onListedExampleInput(
    definitionIndex: number,
    kind: ExampleFieldKind,
    index: number | null,
    event: Event,
  ): void {
    if (kind === 'saved' && index != null) this.onExampleField(definitionIndex, index, event);
    else if (kind === 'addition' && index != null)
      this.onExampleAddition(definitionIndex, index, event);
    else if (kind === 'draft') this.onExampleDraftField(definitionIndex, event);
  }

  async generateExampleField(): Promise<void> {
    const engineer = this.exampleFieldEngineer();
    const instruction = engineer?.instruction.trim() ?? '';
    const grammar = engineer ? this.grammarTarget(engineer.grammarId) : undefined;
    if (!engineer || this.aiBusy() || (!instruction && !grammar)) return;
    const element = this.currentElement();
    const definition = element.definitions[engineer.definitionIndex];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    if (!readStoredAiCredentials().keys.length) {
      this.exampleError.set('Save an API key first.');
      return;
    }
    const current = this.exampleFieldText(engineer);
    const index = engineer.definitionIndex;
    const job = ++this.exampleJob;
    this.askingExamples.set(index);
    this.exampleError.set('');
    try {
      const examples = await generateExamples({
        language: element.language,
        title: element.title,
        gloss,
        translation: this.translationTarget(),
        metadata: definition.metadata,
        existingExamples: this.otherExampleTexts(engineer),
        forms: definition.forms.map((form) => form.text),
        exampleWords: [],
        exampleInstruction: instruction,
        ...(current ? { currentExample: current } : {}),
        ...this.grammarRequest(engineer.grammarId),
      });
      const sentence = parsePassage(examples[0]?.text ?? '').text;
      const showing = this.element().id === element.id;
      const open = showing ? this.exampleFieldEngineer() : null;
      const same =
        !!open &&
        open.definitionIndex === index &&
        open.kind === engineer.kind &&
        open.index === engineer.index;
      if (!showing || !same) return;
      if (!sentence || (current && sentence.toLowerCase() === current.toLowerCase())) {
        this.exampleError.set(
          current ? 'Could not change that example.' : 'Could not write that example.',
        );
        return;
      }
      this.setExampleFieldText(engineer, sentence);
    } catch {
      if (this.element().id === element.id) {
        this.exampleError.set(
          current ? 'Could not change that example.' : 'Could not write that example.',
        );
      }
    } finally {
      if (this.exampleJob === job && this.element().id === element.id)
        this.askingExamples.set(null);
    }
  }

  onExampleField(definitionIndex: number, exampleIndex: number, event: Event): void {
    const value = this.inputValue(event);
    this.exampleEdits.update((current) => {
      const next = new Map(current);
      next.set(this.exampleEditKey(definitionIndex, exampleIndex), value);
      return next;
    });
  }

  exampleDraftFieldValue(index: number): string {
    const draft = this.exampleDraftFor(index);
    if (!draft) return '';
    const field = this.exampleDraftField();
    if (field?.definitionIndex === index) return field.text;
    return plainPassage(draft.text);
  }

  onExampleDraftField(index: number, event: Event): void {
    this.exampleDraftField.set({ definitionIndex: index, text: this.inputValue(event) });
  }

  async saveExampleEdits(): Promise<void> {
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition' || this.busy()) return;
    const index = editor.index;
    if (!this.examplesDirty(index)) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[index];
    if (!definition) return;
    const seen = new Set<string>();
    for (let exampleIndex = 0; exampleIndex < definition.examples.length; exampleIndex += 1) {
      const example = definition.examples[exampleIndex];
      const baseline = plainPassage(example.text);
      const draft = this.exampleEdits().get(this.exampleEditKey(index, exampleIndex)) ?? baseline;
      const nextText = this.exampleTextToStore(draft);
      if (!parsePassage(nextText).text.trim()) {
        this.exampleError.set('An example needs text.');
        return;
      }
      const key = senseKey(nextText);
      if (!key || seen.has(key)) {
        this.exampleError.set('That example is already there.');
        return;
      }
      seen.add(key);
      example.text = nextText;
    }
    const created: string[] = [];
    for (const row of this.exampleAdditions().get(index) ?? []) {
      if (!plainPassage(row)) continue;
      const text = this.exampleTextToStore(row);
      const key = senseKey(text);
      if (!key || seen.has(key)) {
        this.exampleError.set('That example is already there.');
        return;
      }
      seen.add(key);
      definition.examples.push({ text, metadata: {} });
      created.push(text);
    }
    const pending = this.exampleDraftFor(index);
    if (pending) {
      const field = this.exampleDraftField();
      const edited = field?.definitionIndex === index;
      const text = this.exampleTextToStore(edited ? field.text : pending.text);
      if (!parsePassage(text).text.trim()) {
        this.exampleError.set('An example needs text.');
        return;
      }
      const key = senseKey(text);
      if (!key || seen.has(key)) {
        this.exampleError.set('That example is already there.');
        return;
      }
      seen.add(key);
      definition.examples.push({ text, metadata: { ...pending.metadata } });
      created.push(text);
    }
    for (const text of created) this.appendExample(definition, text);
    this.exampleError.set('');
    if (!(await this.persist(definitions, this.currentElement().equivalents))) return;
    this.closeEditor();
  }

  private examplesDirty(index: number): boolean {
    const definition = this.sheetDefinition(index);
    if (!definition) return false;
    for (let exampleIndex = 0; exampleIndex < definition.examples.length; exampleIndex += 1) {
      const baseline = plainPassage(definition.examples[exampleIndex].text);
      const draft = this.exampleEdits().get(this.exampleEditKey(index, exampleIndex));
      if (draft != null && draft !== baseline && plainPassage(draft)) return true;
    }
    if ((this.exampleAdditions().get(index) ?? []).some((row) => plainPassage(row))) return true;
    return !!parsePassage(this.exampleDraftFor(index)?.text ?? '').text.trim();
  }

  private exampleEditKey(definitionIndex: number, exampleIndex: number): string {
    return `${definitionIndex}:${exampleIndex}`;
  }

  /** The example sentence, without a translation marker. */
  private exampleTextToStore(draft: string): string {
    return plainPassage(draft);
  }

  private shiftExampleEditDefinitions(by: number): void {
    if (!by) return;
    this.exampleEdits.update((current) => {
      const next = new Map<string, string>();
      for (const [key, value] of current) {
        const split = key.indexOf(':');
        const definitionIndex = Number(key.slice(0, split)) + by;
        next.set(`${definitionIndex}:${key.slice(split + 1)}`, value);
      }
      return next;
    });
    this.exampleAdditions.update((current) => {
      const next = new Map<number, string[]>();
      for (const [index, rows] of current) next.set(index + by, rows);
      return next;
    });
    const field = this.exampleDraftField();
    if (field)
      this.exampleDraftField.set({ ...field, definitionIndex: field.definitionIndex + by });
    const engineer = this.exampleFieldEngineer();
    if (engineer)
      this.exampleFieldEngineer.set({
        ...engineer,
        definitionIndex: engineer.definitionIndex + by,
      });
  }

  private dropDefinitionExampleEdits(index: number): void {
    this.exampleEdits.update((current) => {
      const next = new Map<string, string>();
      for (const [key, value] of current) {
        const split = key.indexOf(':');
        const definitionIndex = Number(key.slice(0, split));
        if (definitionIndex === index) continue;
        const shifted = definitionIndex > index ? definitionIndex - 1 : definitionIndex;
        next.set(`${shifted}:${key.slice(split + 1)}`, value);
      }
      return next;
    });
    this.exampleAdditions.update((current) => {
      const next = new Map<number, string[]>();
      for (const [definitionIndex, rows] of current) {
        if (definitionIndex === index) continue;
        next.set(definitionIndex > index ? definitionIndex - 1 : definitionIndex, rows);
      }
      return next;
    });
    const field = this.exampleDraftField();
    if (field?.definitionIndex === index) this.exampleDraftField.set(null);
    else if (field && field.definitionIndex > index) {
      this.exampleDraftField.set({ ...field, definitionIndex: field.definitionIndex - 1 });
    }
    const engineer = this.exampleFieldEngineer();
    if (engineer?.definitionIndex === index) this.exampleFieldEngineer.set(null);
    else if (engineer && engineer.definitionIndex > index) {
      this.exampleFieldEngineer.set({
        ...engineer,
        definitionIndex: engineer.definitionIndex - 1,
      });
    }
  }

  private dropExampleEdit(definitionIndex: number, exampleIndex: number): void {
    this.exampleEdits.update((current) => {
      const next = new Map<string, string>();
      for (const [key, value] of current) {
        const split = key.indexOf(':');
        const definition = Number(key.slice(0, split));
        const example = Number(key.slice(split + 1));
        if (definition !== definitionIndex) {
          next.set(key, value);
          continue;
        }
        if (example === exampleIndex) continue;
        const shifted = example > exampleIndex ? example - 1 : example;
        next.set(`${definition}:${shifted}`, value);
      }
      return next;
    });
    const engineer = this.exampleFieldEngineer();
    if (
      !engineer ||
      engineer.definitionIndex !== definitionIndex ||
      engineer.kind !== 'saved' ||
      engineer.index == null
    ) {
      return;
    }
    if (engineer.index === exampleIndex) this.exampleFieldEngineer.set(null);
    else if (engineer.index > exampleIndex) {
      this.exampleFieldEngineer.set({ ...engineer, index: engineer.index - 1 });
    }
  }

  private exampleFieldText(engineer: ExampleFieldEngineer): string {
    if (engineer.kind === 'saved' && engineer.index != null) {
      return plainPassage(this.exampleFieldValue(engineer.definitionIndex, engineer.index));
    }
    if (engineer.kind === 'addition' && engineer.index != null) {
      return plainPassage(this.exampleAdditionValue(engineer.definitionIndex, engineer.index));
    }
    return plainPassage(this.exampleDraftFieldValue(engineer.definitionIndex));
  }

  private otherExampleTexts(engineer: ExampleFieldEngineer): string[] {
    const index = engineer.definitionIndex;
    const definition = this.sheetDefinition(index);
    const texts: string[] = [];
    const seen = new Set<string>();
    const add = (value: string) => {
      const text = plainPassage(value).trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      texts.push(text);
    };
    definition?.examples.forEach((_, exampleIndex) => {
      if (engineer.kind === 'saved' && engineer.index === exampleIndex) return;
      add(this.exampleFieldValue(index, exampleIndex));
    });
    (this.exampleAdditions().get(index) ?? []).forEach((row, additionIndex) => {
      if (engineer.kind === 'addition' && engineer.index === additionIndex) return;
      add(row);
    });
    if (engineer.kind !== 'draft') add(this.exampleDraftFieldValue(index));
    return texts;
  }

  private setExampleFieldText(engineer: ExampleFieldEngineer, text: string): void {
    const row = engineer.index;
    if (engineer.kind === 'saved' && row != null) {
      this.exampleEdits.update((current) => {
        const next = new Map(current);
        next.set(this.exampleEditKey(engineer.definitionIndex, row), text);
        return next;
      });
      return;
    }
    if (engineer.kind === 'addition' && row != null) {
      this.exampleAdditions.update((current) => {
        const rows = [...(current.get(engineer.definitionIndex) ?? [])];
        if (row >= rows.length) return current;
        rows[row] = text;
        const next = new Map(current);
        next.set(engineer.definitionIndex, rows);
        return next;
      });
      return;
    }
    this.exampleDraftField.set({ definitionIndex: engineer.definitionIndex, text });
  }

  discardExampleDraft(): void {
    if (this.askingExamples() !== null) return;
    if (this.exampleFieldEngineer()?.kind === 'draft') this.exampleFieldEngineer.set(null);
    this.exampleDraft.set(null);
    this.exampleDraftField.set(null);
    this.exampleError.set('');
  }

  openExistingForm(definitionIndex: number, text: string): void {
    if (this.busy()) return;
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

  private editedTitle(): string {
    return this.titleDraft().replace(/\s+/g, ' ').trim().slice(0, FORM_MAX_LENGTH);
  }

  private titleChanged(): boolean {
    return this.editedTitle() !== this.element().title;
  }

  showCollision(
    event: MouseEvent,
    matches: DefinitionHighlightMatch[],
    definition: number,
    example = '',
    selected = '',
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.collisionDefinition = definition;
    this.collisionExample = example.trim();
    this.collisionWord = selected.replace(/\s+/g, ' ').trim();
    this.collision.set(matches);
  }

  visitCollision(id: string): void {
    const example = this.collisionExample;
    const word = this.collisionWord;
    const definition = this.collisionDefinition;
    if (example) {
      this.visitHighlight(id, definition, example);
      return;
    }
    this.openFromDefinition(id, definition, word);
  }

  openFromDefinition(id: string, definitionIndex: number, selected: string): void {
    const gloss = parsePassage(this.element().definitions[definitionIndex]?.text ?? '')
      .text.replace(/\s+/g, ' ')
      .trim();
    const root = this.element().title.replace(/\s+/g, ' ').trim();
    const word = selected.replace(/\s+/g, ' ').trim();
    const guide = gloss && root && word ? `${root}: ${gloss}` : '';
    this.visitHighlight(id, definitionIndex, '', guide);
  }

  visitHighlight(
    id: string,
    definition = this.collisionDefinition,
    example = '',
    guide = '',
  ): void {
    this.collision.set(null);
    this.collisionExample = '';
    this.collisionWord = '';
    if (!id || id === this.element().id) return;
    this.visit.emit({ id, definition, example: example.trim(), guide: guide.trim() });
  }

  confirmPassagePick(event: Event, text: string): void {
    event.preventDefault();
    event.stopPropagation();
    const title = text.replace(/\s+/g, ' ').trim();
    if (!title || this.aiBusy()) return;
    this.addingSelection.set(true);
    this.blockPassageSelectionUntil = Date.now() + 400;
    window.getSelection()?.removeAllRanges();
    void this.askSelectionElement(title, this.passageSelection());
  }

  private async askSelectionElement(title: string, pick: PassageSelection | null): Promise<void> {
    const element = this.element();
    const definition = pick ? element.definitions[pick.definitionIndex] : undefined;
    const raw =
      pick?.exampleIndex == null ? definition?.text : definition?.examples[pick.exampleIndex]?.text;
    const passage = parsePassage(raw ?? '');
    const fromExample = pick?.exampleIndex != null;
    const gloss = passage.text.replace(/\s+/g, ' ').trim();
    const root = element.title.replace(/\s+/g, ' ').trim();
    const definitionIndex = pick?.definitionIndex ?? 0;
    const guide = !fromExample && gloss && root ? `${root}: ${gloss}` : '';
    const example = fromExample ? passage.text : '';
    this.addingSelection.set(true);
    this.error.set('');
    try {
      const generated = await this.elementFromSelection(
        element.language,
        title,
        pick && gloss
          ? {
              kind: fromExample ? 'example' : 'definition',
              phrase: gloss,
              ...(root ? { root } : {}),
            }
          : undefined,
      );
      if (this.element().id !== element.id) return;
      if (generated) {
        this.passageSelection.set(null);
        this.addPrepared.emit({
          title: generated.lemma,
          language: element.language,
          example,
          guide,
          definition: definitionIndex,
          definitions: generated.definitions.map((sense) => ({
            text: sense.text,
            equivalent: sense.equivalent,
            equivalentIds: {},
            forms: selectionForms(generated.lemma, title),
            examples: sense.example ? [{ text: sense.example, metadata: {} }] : [],
            metadata: { ...sense.metadata },
          })),
        });
        return;
      }
      const saved = await this.saveBareSelection(
        title,
        element.language,
        definitionIndex,
        example,
        guide,
      );
      if (!saved && this.element().id === element.id) {
        this.error.set('Could not add that element.');
      }
    } finally {
      if (this.element().id === element.id) this.addingSelection.set(false);
    }
  }

  private elementFromSelection(
    language: string,
    selected: string,
    context?: { kind: 'definition' | 'example'; phrase: string; root?: string },
  ) {
    return generateElementFromSelection({
      language,
      selected,
      translation: this.translationTarget(),
      ...(context ? { context } : {}),
    }).catch(() => null);
  }

  private saveBareSelection(
    title: string,
    language: string,
    definition: number,
    example: string,
    guide: string,
  ): Promise<boolean> {
    this.passageSelection.set(null);
    return new Promise((resolve) => {
      this.addSelection.emit({ title, language, definition, example, guide, done: resolve });
    });
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
    const current = this.passageSelection();
    if (
      current?.text === pick?.text &&
      current?.definitionIndex === pick?.definitionIndex &&
      current?.exampleIndex === pick?.exampleIndex &&
      current?.top === pick?.top &&
      current?.left === pick?.left &&
      current?.before === pick?.before &&
      current?.visible === pick?.visible
    ) {
      return;
    }
    this.passageSelection.set(pick);
  };

  private readonly onSelectionPointerDown = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.sense-selectable, .lookup-chip, .lookup-float')) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (!element?.closest('.sense-selectable')) return;
    selection.removeAllRanges();
    this.passageSelection.set(null);
  };

  draftGloss(): string {
    return plainPassage(this.textDraft());
  }

  /** The translation for the exact wording in the field. A different wording has none. */
  draftTranslationText(): string {
    const phrase = this.draftGloss();
    if (!phrase || !this.supportAvailable()) return '';
    const shown = this.draftTranslation();
    if (shown?.phrase === phrase && shown.text.trim()) return shown.text.trim();
    return this.storedDraftTranslation(phrase);
  }

  /** Translation shown under the definition, including an unsaved edit or a clear. */
  definitionTranslationField(): string {
    const phrase = this.draftGloss();
    const edit = this.translationEdit();
    if (edit?.phrase === phrase) return edit.text;
    if (phrase && this.translationCleared() === phrase) return '';
    return this.draftTranslationText();
  }

  /** Equivalent shown under the definition, including an unsaved edit. */
  definitionEquivalentField(): string {
    const edit = this.equivalentEdit();
    return edit ?? this.sheetEquivalent();
  }

  onDefinitionTranslationInput(event: Event): void {
    this.translationEdit.set({ phrase: this.draftGloss(), text: this.inputValue(event) });
  }

  onDefinitionEquivalentInput(event: Event): void {
    this.equivalentEdit.set(this.inputValue(event).slice(0, EQUIVALENT_MAX));
  }

  commitDefinitionTranslation(): void {
    const phrase = this.draftGloss();
    const edit = this.translationEdit();
    if (!phrase || !edit || edit.phrase !== phrase) return;
    const next = edit.text.trim();
    const current = this.draftTranslationText().trim();
    this.translationEdit.set(null);
    if (next === current && this.translationCleared() !== phrase) return;
    replacePhraseTranslation(this.element().language, this.translationTarget(), phrase, next);
    this.translationCleared.set(next ? '' : phrase);
    this.draftTranslation.set(next ? { phrase, text: next } : null);
  }

  commitDefinitionEquivalent(): void {
    const edit = this.equivalentEdit();
    if (edit == null) return;
    const next = edit.trim().slice(0, EQUIVALENT_MAX);
    const editor = this.editor();
    if (!editor || editor.kind !== 'definition') return;
    const element = this.currentElement();
    const definition = element.definitions[editor.index];
    if (!definition) return;
    const language = this.translationTarget();
    const current = equivalentTextFor(element.equivalents, definition.equivalentIds, language);
    if (next === current) {
      this.equivalentEdit.set(null);
      return;
    }
    const definitions = this.copyDefinitions();
    const sense = definitions[editor.index];
    if (!sense) return;
    const code = language.trim().toLowerCase().split('-')[0] ?? '';
    const oldId = code ? (sense.equivalentIds[code] ?? '') : '';
    const shared =
      !!oldId &&
      definitions.some(
        (item, index) => index !== editor.index && item.equivalentIds[code] === oldId,
      );
    let equivalents = element.equivalents.map((item) => ({ ...item }));
    if (!next) {
      sense.equivalentIds = linkEquivalent(sense.equivalentIds, language, null);
    } else if (oldId && !shared) {
      const clash = equivalents.find(
        (item) => item.id !== oldId && item.language === code && item.text === next,
      );
      if (clash) {
        sense.equivalentIds = linkEquivalent(sense.equivalentIds, language, clash.id);
      } else {
        equivalents = equivalents.map((item) =>
          item.id === oldId ? { ...item, text: next } : item,
        );
      }
    } else {
      const linked = assignEquivalent(equivalents, next, language);
      equivalents = linked.equivalents;
      sense.equivalentIds = linkEquivalent(sense.equivalentIds, language, linked.equivalentId);
    }
    this.equivalentEdit.set(null);
    this.recordRework(definition, definition.text, next, definition.metadata);
    void this.persist(definitions, equivalents, { busy: false });
  }

  canTranslate(): boolean {
    const shown =
      this.editor()?.kind === 'definition'
        ? this.definitionTranslationField()
        : this.draftTranslationText();
    return (
      this.supportAvailable() &&
      this.draftGloss().length > 0 &&
      !shown.trim() &&
      !this.translating() &&
      !this.busy()
    );
  }

  async translateDraft(): Promise<void> {
    if (!this.canTranslate()) return;
    const text = this.draftGloss();
    const source = this.element().language;
    const target = this.translationTarget();
    const ticket = this.translateTicket;
    const editor = this.editor();
    this.translating.set(true);
    this.sheetError.set('');
    try {
      const translated =
        editor?.kind === 'definition'
          ? await this.translateDefinitionDraft(editor.index, source, target, text)
          : await requestPhraseTranslation(source, target, text);
      if (ticket !== this.translateTicket) return;
      this.translationEdit.set(null);
      this.translationCleared.set('');
      this.draftTranslation.set({ phrase: text, text: translated });
    } catch {
      if (ticket !== this.translateTicket) return;
      this.sheetError.set('Could not translate this.');
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  private async translateDefinitionDraft(
    index: number,
    source: string,
    target: string,
    text: string,
  ): Promise<string> {
    const result = await requestDefinitionTranslation(
      source,
      target,
      text,
      this.element().title,
      this.sheetEquivalent(),
    );
    if (result.equivalent.trim() && !this.sheetEquivalent()) {
      await this.storeMissingEquivalent(index, result.equivalent);
    }
    return result.translation;
  }

  /** Write the definition draft. `close` leaves the sheet; otherwise the sheet stays on the saved sense. */
  private async commitDefinition(close: boolean): Promise<number | null> {
    const editor = this.editor();
    const primary = this.draftGloss();
    if (
      !editor ||
      editor.kind !== 'definition' ||
      !primary ||
      this.busy() ||
      this.asking() ||
      this.translating()
    ) {
      return null;
    }
    const text = this.phraseToStore();
    const element = this.currentElement();
    const definitions = this.copyDefinitions();
    const current = definitions[editor.index];
    if (!current) return null;
    const equivalent = equivalentTextFor(
      element.equivalents,
      current.equivalentIds,
      this.translationTarget(),
    );
    const metadata = this.metadataToStore();
    const next: ElementDefinition = {
      text,
      equivalentIds: current.equivalentIds,
      forms: current.forms,
      examples: current.examples,
      metadata,
    };
    definitions[editor.index] = next;
    this.recordRework(current, text, equivalent, metadata);
    if (!(await this.persist(definitions, element.equivalents))) return null;
    const still = this.editor();
    const sameSheet = still?.kind === 'definition' && still.index === editor.index;
    if (!sameSheet) return null;
    if (close) this.closeEditor();
    return editor.index;
  }

  async saveEditor(): Promise<void> {
    const editor = this.editor();
    if (!editor) return;
    if (editor.kind === 'definition') {
      await this.commitDefinition(true);
      return;
    }
    const primary = this.draftGloss();
    if (!primary || this.busy() || this.asking() || this.translating()) {
      return;
    }
    const text = this.phraseToStore();
    const definitions = this.copyDefinitions();
    if (editor.kind !== 'example') return;
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
      this.openExamples(definitionIndex);
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
    if (pending.kind === 'exercise') {
      const entry = this.elementHistory()[pending.historyIndex];
      if (entry?.event === 'delete') return 'Delete this deletion?';
      if (entry?.event === 'example') return 'Delete this example?';
      if (entry?.event === 'form') return 'Delete these forms?';
      if (entry?.event === 'reveal') return 'Delete this revealed event?';
      return 'Delete this exercise?';
    }
    return 'Delete this example?';
  }

  confirmHint(pending: ConfirmDelete): string {
    if (
      pending.kind === 'element' ||
      (pending.kind === 'exercise' && this.historyEmptiesElement(pending.historyIndex))
    ) {
      return 'If you delete all the history, this element is lost. Stats are recomputed.';
    }
    if (pending.kind === 'definition') return 'This definition will be removed.';
    return 'This will be removed.';
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
    if (this.aiBusy() || this.busy()) return;
    if (!this.element().definitions[index]) return;
    this.confirm.set({ kind: 'definition', index });
  }

  askDeleteExample(definitionIndex: number, exampleIndex: number): void {
    if (this.aiBusy() || this.busy()) return;
    this.confirm.set({ kind: 'example', definitionIndex, exampleIndex });
  }

  askDeleteExercise(entry: DefinitionHistoryEntry): void {
    if (this.busy() || entry.event === 'rework') return;
    const historyIndex = this.elementHistory().indexOf(entry);
    if (historyIndex < 0) return;
    this.confirm.set({ kind: 'exercise', definitionIndex: 0, historyIndex });
  }

  /** Change the score shown for one attempt. A definition's extra point stays added on top. */
  updateGameScore(entry: DefinitionGameLog, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || this.busy() || this.gaveUp(entry)) {
      return;
    }
    const max = this.scoreMax;
    const typed = Math.round(Number(target.value));
    const shown = Number.isInteger(typed) ? Math.min(max, Math.max(0, typed)) : null;
    if (shown == null) {
      target.value = String(this.shownGameScore(entry));
      return;
    }
    target.value = String(shown);
    const score = entry.game === 'definition' && entry.extra ? shown + 1 : shown;
    if (score === entry.score) return;
    const current = this.currentElement();
    const logIndex = current.log.indexOf(entry);
    if (logIndex < 0) return;
    const scored: DefinitionGameLog = { ...entry, score };
    this.written = {
      ...current,
      log: current.log.map((item, index) => (index === logIndex ? scored : item)),
    };
    void this.persist(this.copyDefinitions(), this.currentElement().equivalents, { busy: false });
  }

  async confirmDelete(): Promise<void> {
    const pending = this.confirm();
    if (!pending || this.busy()) return;
    if (pending.kind === 'element') {
      await this.removeElement();
      return;
    }
    if (pending.kind === 'exercise') {
      await this.removeExercise(pending.historyIndex);
      return;
    }
    const definitions = this.copyDefinitions();
    const archived = pending.kind === 'definition' ? definitions[pending.index] : undefined;
    const removed = archived ? senseKey(archived.text) : '';
    if (pending.kind === 'definition') {
      if (!archived) {
        this.confirm.set(null);
        return;
      }
      this.appendLog(this.deletedDefinitionLog(archived));
      definitions.splice(pending.index, 1);
    } else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    if (pending.kind === 'definition') {
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
      this.dropSenseState(pending.index);
      this.dropDefinitionExampleEdits(pending.index);
    }
    this.confirm.set(null);
    if (pending.kind === 'definition') {
      this.editor.set(null);
    } else {
      this.adjustExampleEditor(pending.definitionIndex, pending.exampleIndex);
      this.dropExampleEdit(pending.definitionIndex, pending.exampleIndex);
    }
  }

  private adjustExampleEditor(definitionIndex: number, exampleIndex: number): void {
    const editor = this.editor();
    if (editor?.kind !== 'example' || editor.definitionIndex !== definitionIndex) return;
    if (editor.exampleIndex === exampleIndex) this.editor.set(null);
    else if (editor.exampleIndex != null && editor.exampleIndex > exampleIndex) {
      this.editor.set({ ...editor, exampleIndex: editor.exampleIndex - 1 });
    }
  }

  private historyEmptiesElement(historyIndex: number): boolean {
    const entry = this.elementHistory()[historyIndex];
    if (!entry) return false;
    const current = this.currentElement();
    const logIndex = current.log.indexOf(entry);
    if (logIndex < 0) return false;
    return !current.log.some((item, index) => index !== logIndex && this.listedHistory(item));
  }

  private async removeExercise(historyIndex: number): Promise<void> {
    const elementId = this.element().id;
    const entry = this.elementHistory()[historyIndex];
    const current = this.currentElement();
    const logIndex = entry ? current.log.indexOf(entry) : -1;
    if (!entry || entry.event === 'rework' || logIndex < 0) {
      this.confirm.set(null);
      return;
    }
    const log = current.log.filter((_, index) => index !== logIndex);
    if (!log.some((item) => this.listedHistory(item))) {
      await this.removeElement();
      return;
    }
    this.written = {
      ...current,
      log,
    };
    if (!(await this.persist(this.copyDefinitions(), current.equivalents))) return;
    if (!this.alive || this.element().id !== elementId) {
      this.confirm.set(null);
      return;
    }
    this.confirm.set(null);
    this.exerciseEntry.set(-1);
  }

  /** Keep the open attempt pointed at the same log entry after one is removed. */

  private async removeElement(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.element().id;
      await deleteElement(id);
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
    };
  }

  /** Append a rework when the passage, equivalent, or metadata changed. */
  private recordRework(
    current: ElementDefinition | null,
    text: string,
    equivalent: string,
    metadata: ElementMetadata,
  ): void {
    if (!current) return;
    const before = this.snapshotWithMetadata(this.snapshotOf(current), current.metadata);
    const after = this.snapshotWithMetadata({ text, equivalent }, metadata);
    if (
      before.text === after.text &&
      before.equivalent === after.equivalent &&
      this.sameMetadata(current.metadata, metadata)
    ) {
      return;
    }
    this.appendLog({ event: 'rework', at: Date.now(), before, after });
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
    this.appendLog({
      event: 'example',
      at: Date.now(),
      example,
      snapshot: this.snapshotOf(definition),
    });
  }

  /** Forms saved in one action keep the definition they were added to. */
  private appendForm(definition: ElementDefinition, forms: string[]): void {
    this.appendLog({
      event: 'form',
      at: Date.now(),
      forms,
      snapshot: this.snapshotOf(definition),
    });
  }

  /** A deletion keeps the sense, so it can be restored with its equivalent, examples, and forms. */
  private deletedDefinitionLog(definition: ElementDefinition): DefinitionDeleteLog {
    const pool = this.currentElement().equivalents;
    const equivalents = Object.entries(definition.equivalentIds).flatMap(([language, id]) => {
      const text = pool.find((item) => item.id === id)?.text.trim() ?? '';
      return language && text ? [{ language, text }] : [];
    });
    return {
      event: 'delete',
      at: Date.now(),
      definition: this.snapshotWithMetadata(this.snapshotOf(definition), definition.metadata),
      ...(definition.forms.length
        ? {
            forms: definition.forms.map((form) => ({
              text: form.text,
              metadata: { ...form.metadata },
            })),
          }
        : {}),
      ...(definition.examples.length
        ? {
            examples: definition.examples.map((example) => ({
              text: example.text,
              metadata: { ...example.metadata },
            })),
          }
        : {}),
      ...(equivalents.length ? { equivalents } : {}),
    };
  }

  /** Activity is stored on the element, in the order it happened. */
  private appendLog(entry: DefinitionLogEntry): void {
    const current = this.currentElement();
    this.written = { ...current, log: [...current.log, entry] };
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

  /** Link an equivalent found with a definition translation. An existing link stays. */
  noteEquivalent(index: number, equivalent: string): void {
    void this.storeMissingEquivalent(index, equivalent);
  }

  private async storeMissingEquivalent(index: number, text: string): Promise<void> {
    const wording = text.trim().slice(0, EQUIVALENT_MAX);
    const language = this.translationTarget();
    if (!wording || !language) return;
    const element = this.currentElement();
    const definition = element.definitions[index];
    if (!definition) return;
    if (equivalentTextFor(element.equivalents, definition.equivalentIds, language)) return;
    const linked = assignEquivalent(element.equivalents, wording, language);
    if (!linked.equivalentId) return;
    const definitions = this.copyDefinitions();
    const current = definitions[index];
    if (!current) return;
    if (equivalentTextFor(element.equivalents, current.equivalentIds, language)) return;
    current.equivalentIds = linkEquivalent(current.equivalentIds, language, linked.equivalentId);
    await this.persist(definitions, linked.equivalents, { busy: false });
  }

  activityCount(event: 'rework'): number {
    return this.currentElement().log.filter((entry) => entry.event === event).length;
  }

  activityLabel(event: 'rework', count: number): string {
    return count === 1 ? 'Reworked 1 time' : `Reworked ${count} times`;
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
    this.askingMetadata.set(false);
    this.draftTranslation.set(null);
    this.translationEdit.set(null);
    this.translationCleared.set('');
    this.equivalentEdit.set(null);
    this.exampleTranslationEdit.set(null);
    this.exampleTranslationCleared.set('');
    this.textDraft.set(plainPassage(text));
    this.sheetError.set('');
    this.translating.set(false);
  }

  private phraseToStore(): string {
    return plainPassage(this.textDraft());
  }

  /** Show a translation this definition already has, with its equivalent beside it. */
  private showStoredDraftTranslation(): void {
    const phrase = this.draftGloss();
    const text = this.storedDraftTranslation(phrase);
    this.draftTranslation.set(text ? { phrase, text } : null);
  }

  private storedDraftTranslation(phrase: string): string {
    const cached =
      readPhraseTranslation(
        this.element().language,
        this.translationTarget(),
        phrase,
      )?.text.trim() ?? '';
    if (cached) return cached;
    return '';
  }

  private focusDraft(): void {
    setTimeout(() => this.draftField()?.nativeElement.focus());
  }

  dialogLabel(): string {
    return this.shownTitle();
  }

  /** Mean recall score for this element. NA when it has not been exercised. */
  scoreAverage(): string {
    const average = definitionScoreAverage(this.currentElement());
    if (average == null) return 'NA';
    return average.toFixed(1);
  }

  scoreAverageLabel(): string {
    const average = this.scoreAverage();
    if (average === 'NA') return 'Score not available';
    return `Score average ${average} out of 10`;
  }

  /** CSS color for this element's score, or null when it has not been scored. */
  scoreColorVar(): string | null {
    const average = definitionScoreAverage(this.currentElement());
    if (average == null) return null;
    return `var(--score-${definitionScoreStep(average)})`;
  }

  /** Coverage out of 10 for a recall. The extra sense point is not part of it. */
  shownGameScore(entry: DefinitionGameLog): number {
    return definitionCoverage(entry);
  }

  /** The gem this recall earned, from how far its coverage sits above earlier ones. */
  exerciseGem(
    entry: DefinitionGameLog | DefinitionReworkLog | DefinitionDeleteLog,
  ): GemTier | null {
    if (entry.event !== 'game') return null;
    return storedGem(entry);
  }

  earnedGemLabel(tier: GemTier): string {
    if (tier === 'red') return 'Red gem';
    if (tier === 'orange') return 'Orange gem';
    return 'Green gem';
  }

  readonly scoreMax = DEFINITION_COVERAGE_MAX;

  /** Recall attempts, definition edits, and definition deletions, newest first. */
  shownHistory(): Array<DefinitionGameLog | DefinitionReworkLog | DefinitionDeleteLog> {
    return this.elementHistory().filter(
      (entry): entry is DefinitionGameLog | DefinitionReworkLog | DefinitionDeleteLog =>
        entry.event === 'game' || entry.event === 'rework' || entry.event === 'delete',
    );
  }

  /** The deleted sense can be put back when its wording, an example, or a form was kept. */
  canRestoreDefinition(entry: DefinitionDeleteLog): boolean {
    return !!entry.definition?.text.trim() || !!entry.examples?.length || !!entry.forms?.length;
  }

  /** Put the deleted definition, its equivalent, examples, and forms back on the element. */
  async restoreDefinition(entry: DefinitionDeleteLog): Promise<void> {
    if (this.busy() || !this.canRestoreDefinition(entry)) return;
    const element = this.currentElement();
    let equivalents = element.equivalents.map((item) => ({ ...item }));
    let equivalentIds: EquivalentLinks = {};
    const links = entry.equivalents?.length
      ? entry.equivalents
      : entry.definition?.equivalent.trim()
        ? [{ language: this.translationTarget(), text: entry.definition.equivalent }]
        : [];
    for (const link of links) {
      const assigned = assignEquivalent(equivalents, link.text, link.language);
      equivalents = assigned.equivalents;
      equivalentIds = linkEquivalent(equivalentIds, link.language, assigned.equivalentId);
    }
    const restored: ElementDefinition = {
      text: entry.definition?.text ?? '',
      equivalentIds,
      forms: (entry.forms ?? []).map((form) => ({
        text: form.text,
        metadata: { ...form.metadata },
      })),
      examples: (entry.examples ?? []).map((example) => ({
        text: example.text,
        metadata: { ...example.metadata },
      })),
      metadata: { ...(entry.definition?.metadata ?? {}) },
    };
    const definitions = [...this.copyDefinitions(), restored];
    const logIndex = element.log.indexOf(entry);
    this.written = {
      ...element,
      log: logIndex < 0 ? element.log : element.log.filter((_, index) => index !== logIndex),
    };
    if (!(await this.persist(definitions, equivalents))) return;
    if (!this.alive || this.element().id !== element.id) return;
    this.exerciseEntry.set(-1);
    if (this.recallSettled() || this.recallSkipped()) {
      this.senseStages.update((current) => {
        const next = new Map(current);
        next.set(definitions.length - 1, 'open');
        return next;
      });
    }
  }

  /** Support-language equivalent kept with a deleted definition. */
  deletedEquivalent(entry: DefinitionDeleteLog): string {
    const target = this.translationTarget();
    const match = entry.equivalents?.find((item) => item.language === target);
    return (
      match?.text ||
      entry.equivalents?.[0]?.text ||
      entry.definition?.equivalent ||
      ''
    ).trim();
  }

  /** Definition or example wording, without an embedded translation marker. */
  logPassage(value: string | undefined): string {
    return plainPassage(value ?? '');
  }

  /** Definition wording, with its equivalent after a dot when there is one. */
  logWording(snapshot: DefinitionSnapshot | undefined): string {
    if (!snapshot) return '';
    const text = plainPassage(snapshot.text);
    const equivalent = snapshot.equivalent.trim();
    if (text && equivalent) return `${text} · ${equivalent}`;
    return text || equivalent;
  }

  gaveUp(entry: DefinitionGameLog): boolean {
    return !entry.answer.trim();
  }

  /** Reworks, saved examples, saved forms, and exercises for this element. */
  elementHistory(): DefinitionHistoryEntry[] {
    return this.currentElement()
      .log.filter((entry): entry is DefinitionHistoryEntry => this.listedHistory(entry))
      .reverse();
  }

  historyTitle(entry: DefinitionHistoryEntry): string {
    if (entry.event === 'rework') return 'Reworked';
    if (entry.event === 'delete') return 'Deleted';
    if (entry.event === 'example') return 'Example';
    if (entry.event === 'form') return 'Forms';
    if (entry.event === 'reveal') return 'Revealed';
    return 'Exercise';
  }

  historyAria(entry: DefinitionHistoryEntry): string {
    const when = this.exerciseWhen(entry.at);
    if (entry.event === 'game') {
      const bonus = entry.extra ? ', plus 1' : '';
      return `${this.historyTitle(entry)}, score ${this.shownGameScore(entry)} out of ${this.scoreMax}${bonus}, ${when}`;
    }
    if (entry.event === 'rework') {
      return `Reworked, before ${this.logWording(entry.before)}, after ${this.logWording(entry.after)}, ${when}`;
    }
    if (entry.event === 'delete') {
      return `Deleted, ${this.logWording(entry.definition)}, ${when}`;
    }
    return `${this.historyTitle(entry)}, ${when}`;
  }

  scoreAria(entry: DefinitionGameLog): string {
    const bonus = entry.extra ? ', plus 1' : '';
    return `Score ${this.shownGameScore(entry)} out of ${this.scoreMax}${bonus}`;
  }

  private listedHistory(entry: ElementLogEntry): entry is DefinitionHistoryEntry {
    return (
      entry.event === 'rework' ||
      entry.event === 'delete' ||
      entry.event === 'example' ||
      entry.event === 'form' ||
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

  toggleExerciseEntry(index: number): void {
    this.exerciseEntry.update((current) => (current === index ? -1 : index));
  }

  toggleHistory(): void {
    if (this.recallPending()) return;
    this.exerciseEntry.set(-1);
    this.historyOpen.update((open) => !open);
  }

  openHistory(): void {
    if (this.recallPending()) return;
    this.exerciseEntry.set(-1);
    this.historyOpen.set(true);
  }

  closeExerciseLog(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.exerciseEntry.set(-1);
    this.historyOpen.set(false);
  }
}

function splitExampleGuide(guide: string): { root: string; gloss: string } | null {
  const split = guide.indexOf(': ');
  if (split <= 0) return null;
  const root = guide.slice(0, split).trim();
  const gloss = guide.slice(split + 2).trim();
  if (!root || !gloss) return null;
  return { root, gloss };
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
  const placed = placePassageActions(range, passage);
  return {
    text,
    definitionIndex,
    exampleIndex,
    top: placed?.top ?? 0,
    left: placed?.left ?? 0,
    before: placed?.before ?? false,
    visible: placed != null,
  };
}

function placePassageActions(
  range: Range,
  passage: Element,
): { top: number; left: number; before: boolean } | null {
  const caret = selectionCaret(range);
  if (!caret) return null;
  const scroller = passage.closest('.body, .sheet-scroll');
  if (scroller) {
    const view = scroller.getBoundingClientRect();
    const visibleTop = Math.max(caret.top, view.top);
    const visibleBottom = Math.min(caret.bottom, view.bottom);
    if (visibleBottom - visibleTop < Math.min(caret.height, 8)) return null;
  }
  const width = 120;
  const gap = 8;
  const before = caret.right + gap + width > window.innerWidth - 8;
  return {
    top: Math.round(caret.top + caret.height / 2),
    left: Math.round(before ? caret.left : caret.right),
    before,
  };
}

function selectionCaret(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  return rects.at(-1) ?? null;
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
  const average = definitionScoreAverage(element);
  if (average == null) return { color: '' };
  return { color: `var(--score-${definitionScoreStep(average)})` };
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
