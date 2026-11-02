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
  deleteElement,
  embedTranslation,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  parsePassage,
  saveElement,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementEquivalent,
  type ElementMetadata,
  type PassageTranslation,
  type StoredElement,
} from 'collection';
import {
  MAX_EXAMPLE_INSTRUCTION,
  generateDefinitions,
  generateEquivalent,
  generateExamples,
  generateForms,
  sentenceUsesForm,
} from 'ai';
import { translatePhrase } from '../translate/translate';
import { canSpeak, speakText, stopSpeaking } from './speech';

const FORM_MAX_LENGTH = 100;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;

type Editor =
  | { kind: 'definition'; index: number | null }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number | null };

type FormEdit = { definitionIndex: number };

type MetadataEdit = { previousKey: string | null };

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

type DefinitionSuggestion = { text: string; metadata: ElementMetadata };

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
    suggestions.push({
      text,
      metadata: suggestionMetadata((item as { metadata?: unknown }).metadata),
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

const EXAMPLE_SUGGESTIONS_KEY = 'lingogem.example-suggestions.v1';

function senseKey(text: string): string {
  return parsePassage(text).text.trim().toLowerCase();
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
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="element().title"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-row">
            <h2>{{ element().title }}</h2>
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
          @if (headerEquivalents(); as equivalents) {
            @if (equivalents.length) {
              <p class="equivalents">{{ equivalents.join(', ') }}</p>
            }
          }
          <div class="header-actions">
            @if (canHear(element().title)) {
              <button
                type="button"
                class="icon-btn"
                [class.active]="speaking() === 'title'"
                [attr.aria-pressed]="speaking() === 'title'"
                [attr.aria-label]="speaking() === 'title' ? 'Stop speaking' : 'Hear title'"
                [attr.title]="speaking() === 'title' ? 'Stop speaking' : 'Hear title'"
                (click)="hear('title', element().title)"
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
            <h3>Definitions</h3>
            <div class="header-actions">
              <button
                type="button"
                class="icon-btn"
                aria-label="Ask AI for definitions"
                title="Ask AI for definitions"
                [attr.aria-busy]="asking() ? true : null"
                [disabled]="aiBusy()"
                (click)="askDefinitions()"
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
                aria-label="Add a definition"
                title="Add a definition"
                [disabled]="aiBusy()"
                (click)="openDefinition(null)"
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
                  {{ match.title }}
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
                            <li>{{ translation.text }}</li>
                          }
                        </ul>
                      }
                      @if (entries(suggestion.metadata); as meta) {
                        @if (meta.length) {
                          <ul class="sense-meta">
                            @for (entry of meta; track entry.key) {
                              <li>
                                <span class="sense-meta-key">{{ label(entry.key) }}</span>
                                {{ label(entry.value) }}
                              </li>
                            }
                          </ul>
                        }
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
                        <p class="passage">
                          @for (part of highlightPassage(passage.text, index); track $index) {
                            @if (part.matches.length > 1) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [textContent]="part.text"
                                (click)="showCollision($event, part.matches)"
                              ></button>
                            } @else if (part.matches.length === 1 && !part.current) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [textContent]="part.text"
                                (click)="visitHighlight(part.matches[0].elementId)"
                              ></button>
                            } @else if (part.current) {
                              <span
                                class="linguagem-highlighted linguagem-highlighted--current"
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
                            <li>{{ translation.text }}</li>
                          }
                        </ul>
                      }
                      @let equivalent = equivalentText(definition);
                      @let meta = entries(definition.metadata);
                      @if (equivalent || meta.length) {
                        <ul class="sense-meta">
                          @if (equivalent) {
                            <li class="sense-equivalent">{{ equivalent }}</li>
                          }
                          @for (entry of meta; track entry.key) {
                            <li>
                              <span class="sense-meta-key">{{ label(entry.key) }}</span>
                              {{ label(entry.value) }}
                            </li>
                          }
                        </ul>
                      }
                    </div>
                  </div>
                  <div class="item-actions">
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
                          aria-label="Ask AI for examples"
                          title="Ask AI for examples"
                          [attr.aria-busy]="askingExamples() === index ? true : null"
                          [disabled]="aiBusy()"
                          (click)="openExampleEngineer(index)"
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
                          aria-label="Add an example"
                          title="Add an example"
                          [disabled]="aiBusy()"
                          (click)="openExample(index, null)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (stagedExamples(index); as staged) {
                      @if (staged.length) {
                        <ul class="examples">
                          @for (item of staged; track item.text; let stagedIndex = $index) {
                            <li class="staged-example">
                              <div class="sense-main">
                                <div class="example-quote">
                                  @let passage = parsePassage(item.text);
                                  @if (passage.text) {
                                    <p class="passage">{{ passage.text }}</p>
                                  }
                                  @if (passage.translations.length) {
                                    <ul class="equivalents">
                                      @for (translation of passage.translations; track $index) {
                                        <li>{{ translation.text }}</li>
                                      }
                                    </ul>
                                  }
                                  @if (item.form) {
                                    <p class="hint">Using {{ item.form }}</p>
                                  }
                                </div>
                                <button
                                  type="button"
                                  class="icon-btn"
                                  aria-label="Dismiss example"
                                  title="Dismiss example"
                                  [disabled]="busy()"
                                  (click)="dismissStagedExample(index, stagedIndex)"
                                >
                                  ×
                                </button>
                              </div>
                              <button
                                type="button"
                                class="btn btn-primary add-suggestion"
                                [disabled]="aiBusy()"
                                (click)="addStagedExample(index, stagedIndex)"
                              >
                                Add
                              </button>
                            </li>
                          }
                        </ul>
                      }
                    }
                    @if (definition.examples.length) {
                      <ul class="examples">
                        @for (
                          example of definition.examples;
                          track $index;
                          let exampleIndex = $index
                        ) {
                          <li class="saved-example">
                            <div class="example-quote">
                              @let passage = parsePassage(example.text);
                              @if (passage.text) {
                                <p class="passage">
                                  @for (
                                    part of highlightPassage(passage.text, index);
                                    track $index
                                  ) {
                                    @if (part.matches.length > 1) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [textContent]="part.text"
                                        (click)="showCollision($event, part.matches)"
                                      ></button>
                                    } @else if (part.matches.length === 1 && !part.current) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [textContent]="part.text"
                                        (click)="visitHighlight(part.matches[0].elementId)"
                                      ></button>
                                    } @else if (part.current) {
                                      <span
                                        class="linguagem-highlighted linguagem-highlighted--current"
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
                                    <li>{{ translation.text }}</li>
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
                            </div>
                          </li>
                        }
                      </ul>
                    } @else if (!stagedExamples(index).length) {
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
                          aria-label="Ask AI for forms"
                          title="Ask AI for forms"
                          [attr.aria-busy]="askingForms() === index ? true : null"
                          [disabled]="aiBusy()"
                          (click)="askForms(index)"
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
                          (click)="openForm(index)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (formEdit(); as editing) {
                      @if (editing.definitionIndex === index) {
                        <div class="form-edit">
                          <input
                            #formField
                            [value]="formDraft()"
                            [attr.maxlength]="formMaxLength"
                            placeholder="walked"
                            aria-label="New form"
                            (input)="onFormInput($event)"
                            (keydown.enter)="saveForm()"
                          />
                          <button
                            type="button"
                            class="icon-btn"
                            [disabled]="busy() || !formDraft().trim()"
                            aria-label="Add form"
                            (click)="saveForm()"
                          >
                            <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                          </button>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Cancel"
                            (click)="cancelForm()"
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                        @if (formError()) {
                          <p class="error">{{ formError() }}</p>
                        }
                        <div class="meta">
                          <div class="section-heading">
                            <h3>Features</h3>
                            @if (!formFeatureEdit()) {
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Add feature"
                                title="Add feature"
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
                                aria-label="Feature key"
                                (input)="formFeatureKey.set(inputValue($event))"
                                (keydown.enter)="saveFormFeature()"
                              />
                              <input
                                [value]="formFeatureValue()"
                                [attr.maxlength]="metaValueMaxLength"
                                placeholder="Value"
                                aria-label="Feature value"
                                (input)="formFeatureValue.set(inputValue($event))"
                                (keydown.enter)="saveFormFeature()"
                              />
                              <button
                                type="button"
                                class="icon-btn"
                                [disabled]="
                                  busy() || !formFeatureKey().trim() || !formFeatureValue().trim()
                                "
                                [attr.aria-label]="
                                  feature.previousKey ? 'Save feature' : 'Add feature'
                                "
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
                                        [attr.aria-label]="'Edit feature ' + entry.key"
                                        (click)="openFormFeature(entry.key)"
                                      >
                                        {{ entry.key }}: {{ entry.value }}
                                      </button>
                                      <button
                                        type="button"
                                        class="tag-remove"
                                        [disabled]="busy()"
                                        [attr.aria-label]="'Remove feature ' + entry.key"
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
                      }
                    }
                    @if (definition.forms.length) {
                      <ul class="forms">
                        @for (form of definition.forms; track form.text) {
                          <li>
                            <div class="form-chip">
                              <button
                                type="button"
                                [disabled]="busy()"
                                [attr.aria-label]="'Show metadata for ' + form.text"
                                (click)="openFormInfo(index, form.text)"
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
                    } @else if (formEdit()?.definitionIndex !== index) {
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
                        [attr.aria-label]="'Edit translation ' + item.text"
                        (click)="editTitleTranslation(item.id)"
                      >
                        {{ item.text }}
                      </button>
                      <button
                        type="button"
                        class="tag-remove"
                        [disabled]="busy()"
                        [attr.aria-label]="'Remove translation ' + item.text"
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
                            (click)="chooseEquivalent(item.id)"
                          >
                            {{ item.text }}
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

        @if (formInfo(); as info) {
          <div class="sheet-backdrop" (click)="closeFormInfo($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="'Metadata for ' + info.text"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>{{ info.text }}</h3>
                <button
                  #formInfoClose
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="formInfo.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              @if (formMetadata(info); as features) {
                @if (features.length) {
                  <ul class="pills">
                    @for (entry of features; track entry.key) {
                      <li>
                        <span>{{ entry.key }}: {{ entry.value }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="hint">No metadata yet.</p>
                }
              }
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

    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-width: 0;
    }

    .title-row h2 {
      flex: 1;
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

    .equivalent-block {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.55rem;
      border: 1px solid transparent;
      border-radius: 12px;
    }

    .equivalent-block.missing {
      border-color: color-mix(in srgb, var(--danger) 55%, transparent);
      background: color-mix(in srgb, var(--danger) 12%, transparent);
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
      border: 1px solid rgba(139, 144, 165, 0.16);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, 0.02);
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
      gap: 0.35rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      display: inline-flex;
      align-items: baseline;
      padding: 0.12rem 0.45rem;
      border: 1px solid rgba(139, 144, 165, 0.4);
      border-radius: 0.35rem;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.72rem;
    }

    .sense-meta-key {
      margin-right: 0.35rem;
      font-weight: 600;
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
      padding-inline-start: 1.5rem;
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

    .examples li.saved-example,
    .examples li.staged-example {
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

    .staged-example .example-quote {
      border-left-style: dashed;
      border-left-color: var(--accent-border);
    }

    .staged-example .example-quote .passage {
      color: var(--accent-text);
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

    .engineer-forms {
      max-height: 9rem;
      overflow: auto;
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
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly deleted = output<void>();
  readonly visit = output<string>();

  readonly formMaxLength = FORM_MAX_LENGTH;
  readonly metaKeyMaxLength = META_KEY_MAX_LENGTH;
  readonly metaValueMaxLength = META_VALUE_MAX_LENGTH;
  readonly exampleInstructionMax = MAX_EXAMPLE_INSTRUCTION;
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
  readonly formInfo = signal<{ definitionIndex: number; text: string } | null>(null);
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
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly asking = signal(false);
  readonly askingForms = signal<number | null>(null);
  readonly askingExamples = signal<number | null>(null);
  readonly suggestions = signal<DefinitionSuggestion[]>([]);
  readonly exampleSuggestions = signal<Record<string, ExampleSuggestion[]>>({});
  readonly exampleEngineer = signal<ExampleEngineer | null>(null);
  readonly error = signal('');
  readonly speaking = signal<string | null>(null);
  readonly copied = signal<string | null>(null);

  private translateTicket = 0;
  private equivalentTicket = 0;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private exampleJob = 0;
  private trackedElementId = '';
  private engineerDrafts = new Map<string, EngineerDraft>();
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly draftField = viewChild<ElementRef<HTMLTextAreaElement>>('draftField');
  private readonly formField = viewChild<ElementRef<HTMLInputElement>>('formField');
  private readonly formInfoClose = viewChild<ElementRef<HTMLButtonElement>>('formInfoClose');
  private readonly formFeatureField = viewChild<ElementRef<HTMLInputElement>>('formFeatureField');
  private readonly metaKeyField = viewChild<ElementRef<HTMLInputElement>>('metaKeyField');
  private readonly translationField = viewChild<ElementRef<HTMLInputElement>>('translationField');

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
      this.formInfo.set(null);
      this.formError.set('');
      this.formFeatureEdit.set(null);
      this.metaEdit.set(null);
      this.collision.set(null);
      this.confirm.set(null);
      this.askingForms.set(null);
      this.askingExamples.set(null);
      this.exampleEngineer.set(null);
      this.equivalentTicket += 1;
      this.askingEquivalent.set(false);
      this.dismissTranslations();
      this.engineerDrafts.clear();
      this.loadExampleSuggestions(id);
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => {
      stopWatching();
      stopWatchingExamples();
      this.clearCopied();
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
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
    if (this.formInfo()) {
      this.formInfo.set(null);
      return;
    }
    if (this.formEdit()) {
      this.formEdit.set(null);
      return;
    }
    if (this.exampleEngineer()) {
      this.closeExampleEngineer();
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
      this.busy() || this.asking() || this.askingForms() !== null || this.askingExamples() !== null
    );
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
          })),
          ...this.suggestions().map((suggestion) => ({
            text: suggestion.text,
            metadata: suggestion.metadata,
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
      examples: [],
      metadata: { ...suggestion.metadata },
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
    if (editing) this.formEdit.set({ definitionIndex: map(editing.definitionIndex) });
    const info = this.formInfo();
    if (info) this.formInfo.set({ ...info, definitionIndex: map(info.definitionIndex) });
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
    const forms = this.askingForms();
    if (forms != null) this.askingForms.set(map(forms));
    const engineer = this.exampleEngineer();
    if (engineer) {
      this.exampleEngineer.set({ ...engineer, definitionIndex: map(engineer.definitionIndex) });
    }
  }

  private shiftDefinitionIndexes(by: number): void {
    const editing = this.formEdit();
    if (editing) this.formEdit.set({ definitionIndex: editing.definitionIndex + by });
    const info = this.formInfo();
    if (info) this.formInfo.set({ ...info, definitionIndex: info.definitionIndex + by });
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
    const engineer = this.exampleEngineer();
    if (engineer) {
      this.exampleEngineer.set({ ...engineer, definitionIndex: engineer.definitionIndex + by });
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
    this.dismissTranslations();
    this.sheetMetadata.set({ ...(definition?.metadata ?? {}) });
    const equivalentId = definition?.equivalentId ?? null;
    const known =
      equivalentId && this.element().equivalents.some((item) => item.id === equivalentId)
        ? equivalentId
        : null;
    this.equivalentIdDraft.set(known);
    this.equivalentDraft.set('');
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
    this.dismissTranslations();
    this.sheetMetadata.set({ ...(example?.metadata ?? {}) });
    this.beginSheet(example?.text ?? '');
    this.editor.set({ kind: 'example', definitionIndex, exampleIndex });
    this.focusDraft();
  }

  stagedExamples(index: number): ExampleSuggestion[] {
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!key) return [];
    return this.exampleSuggestions()[key] ?? [];
  }

  definitionForms(index: number): string[] {
    return this.element().definitions[index]?.forms.map((form) => form.text) ?? [];
  }

  openExampleEngineer(index: number): void {
    if (this.aiBusy()) return;
    const definition = this.element().definitions[index];
    const key = senseKey(definition?.text ?? '');
    if (!definition || !key) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formInfo.set(null);
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
      const staged = (
        this.element().id === element.id
          ? (this.exampleSuggestions()[sense] ?? [])
          : (readExampleSuggestions(element.id)[sense] ?? [])
      ).map((item) => parsePassage(item.text).text);
      const examples = await generateExamples({
        language: element.language,
        title: element.title,
        gloss,
        partOfSpeech: definition.metadata['part of speech'],
        existingExamples: [
          ...definition.examples.map((example) => parsePassage(example.text).text),
          ...staged,
        ],
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
      const current =
        this.element().id === element.id
          ? { ...this.exampleSuggestions() }
          : readExampleSuggestions(element.id);
      const list = current[sense] ?? [];
      if (list.some((item) => senseKey(item.text) === senseKey(sentence.text))) {
        if (showing) this.error.set('No further examples.');
        return;
      }
      this.replaceExampleSuggestions(element.id, sense, [
        ...list,
        { text: sentence.text, form: required },
      ]);
      if (showing) this.exampleEngineer.set(null);
    } catch {
      if (this.element().id === element.id) this.error.set('Could not ask for examples.');
    } finally {
      if (this.exampleJob === job && this.element().id === element.id)
        this.askingExamples.set(null);
    }
  }

  dismissStagedExample(definitionIndex: number, stagedIndex: number): void {
    if (this.busy()) return;
    const definition = this.element().definitions[definitionIndex];
    const sense = senseKey(definition?.text ?? '');
    const list = sense ? (this.exampleSuggestions()[sense] ?? []) : [];
    if (!sense || !list[stagedIndex]) return;
    this.replaceExampleSuggestions(
      this.element().id,
      sense,
      list.filter((_, at) => at !== stagedIndex),
    );
  }

  async addStagedExample(definitionIndex: number, stagedIndex: number): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[definitionIndex];
    const sense = senseKey(definition?.text ?? '');
    const suggestion = sense ? this.exampleSuggestions()[sense]?.[stagedIndex] : undefined;
    if (!definition || !sense || !suggestion) return;
    const definitions = this.copyDefinitions();
    const target = definitions[definitionIndex];
    if (!target) return;
    target.examples.push({ text: suggestion.text, metadata: {} });
    if (!(await this.persist(definitions, element.equivalents))) return;
    const list = this.exampleSuggestions()[sense] ?? [];
    this.replaceExampleSuggestions(
      element.id,
      sense,
      list.filter((item) => item !== suggestion),
    );
  }

  openFormInfo(definitionIndex: number, text: string): void {
    if (this.busy()) return;
    const form = this.element().definitions[definitionIndex]?.forms.find(
      (item) => item.text === text,
    );
    if (!form) return;
    this.exampleEngineer.set(null);
    this.formInfo.set({ definitionIndex, text });
    setTimeout(() => this.formInfoClose()?.nativeElement.focus());
  }

  closeFormInfo(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.formInfo.set(null);
  }

  formMetadata(info: { definitionIndex: number; text: string }): Array<{
    key: string;
    value: string;
  }> {
    const form = this.element().definitions[info.definitionIndex]?.forms.find(
      (item) => item.text === info.text,
    );
    return form ? this.entries(form.metadata) : [];
  }

  openForm(definitionIndex: number): void {
    if (!this.element().definitions[definitionIndex]) return;
    this.editor.set(null);
    this.metaEdit.set(null);
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formFeatures.set({});
    this.formDraft.set('');
    this.formEdit.set({ definitionIndex });
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

  highlightPassage(text: string, definitionIndex: number): DefinitionHighlightPart[] {
    const element = this.element();
    const definition = element.definitions[definitionIndex];
    const others: { id: string; title: string; forms: string[] }[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      for (const sense of item.definitions) {
        others.push({ id: item.id, title: item.title, forms: formTexts(sense.forms) });
      }
    }
    return highlightDefinitionPassage(
      text,
      { id: element.id, title: element.title, forms: formTexts(definition?.forms ?? []) },
      others,
    );
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
    if (form === this.element().title.trim()) {
      this.cancelForm();
      return;
    }
    if (!isValidForm(form)) {
      this.formError.set('That form is not valid.');
      return;
    }
    if (definition.forms.some((item) => item.text.toLowerCase() === form.toLowerCase())) {
      this.cancelForm();
      return;
    }
    definition.forms.push({ text: form, metadata: this.formFeaturesToStore() });
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
    if (this.formInfo()?.definitionIndex === definitionIndex && this.formInfo()?.text === form) {
      this.formInfo.set(null);
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
    this.formInfo.set(null);
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
    if (pending.kind === 'definition') {
      definitions.splice(pending.index, 1);
      const info = this.formInfo();
      if (info && info.definitionIndex >= pending.index) this.formInfo.set(null);
    } else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
    if (!(await this.persist(definitions, this.element().equivalents))) return;
    if (pending.kind === 'definition') {
      if (removed && !definitions.some((definition) => senseKey(definition.text) === removed)) {
        this.engineerDrafts.delete(removed);
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
      const asking = this.askingExamples();
      if (asking === pending.index) this.askingExamples.set(null);
      else if (asking != null && asking > pending.index) this.askingExamples.set(asking - 1);
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

  private loadExampleSuggestions(id: string): void {
    const stored = readExampleSuggestions(id);
    const savedBySense = new Map<string, Set<string>>();
    for (const definition of this.element().definitions) {
      const sense = senseKey(definition.text);
      if (!sense) continue;
      const saved = savedBySense.get(sense) ?? new Set<string>();
      for (const example of definition.examples) {
        const key = senseKey(example.text);
        if (key) saved.add(key);
      }
      savedBySense.set(sense, saved);
    }
    const kept: Record<string, ExampleSuggestion[]> = {};
    let dirty = false;
    for (const [sense, list] of Object.entries(stored)) {
      const saved = savedBySense.get(sense);
      if (!saved) {
        dirty = true;
        continue;
      }
      const next = list.filter((item) => {
        const key = senseKey(item.text);
        return !!key && !saved.has(key);
      });
      if (next.length !== list.length) dirty = true;
      if (next.length) kept[sense] = next;
    }
    if (Object.keys(kept).length !== Object.keys(stored).length) dirty = true;
    this.exampleSuggestions.set(kept);
    if (dirty) writeExampleSuggestions(id, kept);
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
