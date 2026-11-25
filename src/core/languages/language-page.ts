import {
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ElementModal } from '../elements/element-modal';
import { GemStatsJob } from '../elements/gem-stats-job';
import { GemStatsModal } from '../elements/gem-stats-modal';
import { readFieldColor, writeFieldColor } from '../elements/metadata-colors';
import { DiscoverModal } from './discover-modal';
import { ensureSelectedLanguage, writeSelectedLanguage } from './selected-language';
import { supportLanguageFor, writeSupportLanguage } from './translation-language';
import { Settings } from '../settings/settings';
import { generateElementFromSelection, readDefinitionMetadataFields } from 'ai';
import {
  addElement,
  catalogFromElements,
  commitElementCatalog,
  compareElements,
  DEFAULT_ELEMENT_SORT,
  deleteElement,
  definitionScoreAverage,
  displayTitle,
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesMetadata,
  elementMatchesPrefix,
  elementMatchesScore,
  elementPrefixSearch,
  elementScoreStep,
  emptyElementCatalog,
  formatMetadataFilter,
  isLearnableLanguage,
  isValidForm,
  LEARNABLE_LANGUAGES,
  grammarCorrectionMarks,
  grammarMistakeOpen,
  grammarRules,
  languageDisplayName,
  type GrammarInput,
  type GrammarInputRule,
  type GrammarMark,
  readGrammarInputs,
  type GrammarMistake,
  mergeMetadataVariability,
  metadataFilterSize,
  parseMetadataFilter,
  readAllElements,
  readElements,
  readMetadataCatalog,
  saveElement,
  sensesWithEquivalents,
  type ElementCatalog,
  type ElementDefinition,
  type ElementMetadataVariability,
  type ElementSearch,
  type ElementSearchPart,
  type ElementSort,
  type StoredElement,
} from 'collection';

type ElementTrailStop = { id: string; definition: number; example?: string; guide?: string };

type FilterSection = 'sort' | 'language' | 'score' | 'definitions' | 'examples' | 'forms';

type MetadataKind = 'definitions' | 'examples' | 'forms';

type ContentSection = {
  id: 'definitions' | 'examples' | 'forms';
  kind: MetadataKind;
  title: string;
  empty: string;
};

const ELEMENT_SKELETONS = [0, 1, 2, 3, 4, 5, 6, 7];
const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 10;
const LEAD_COLORS = ['#FF3366', '#10B981', '#F59E0B', '#A855F7'] as const;

type LeadValue = {
  id: string;
  value: string;
  color: string;
};

function leadValueId(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function leadValueColor(value: string): string {
  const id = leadValueId(value);
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return LEAD_COLORS[(hash >>> 0) % LEAD_COLORS.length];
}

/** Unique values of one definition-metadata field, in definition order. */
function compiledLeadValues(element: StoredElement, fieldKey: string): LeadValue[] {
  const key = leadValueId(fieldKey);
  if (!key) return [];
  const seen = new Set<string>();
  const values: LeadValue[] = [];
  for (const definition of element.definitions) {
    let raw = '';
    for (const [entryKey, entryValue] of Object.entries(definition.metadata)) {
      if (leadValueId(entryKey) !== key) continue;
      raw = entryValue;
      break;
    }
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const id = leadValueId(value);
    if (seen.has(id)) continue;
    seen.add(id);
    values.push({ id, value, color: leadValueColor(value) });
  }
  return values;
}

@Component({
  selector: 'app-language-page',
  imports: [FormsModule, ElementModal, DiscoverModal, Settings, GemStatsModal],
  template: `
    <main>
      <div class="page-top">
        <section class="entries-toolbar" aria-label="Search">
          <form class="search-bar" autocomplete="off" (submit)="askFromSearch($event)">
            <span class="search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              class="entry-input"
              type="search"
              autocomplete="off"
              [value]="query()"
              [attr.maxlength]="maxSearchLength"
              [disabled]="!code()"
              (input)="onSearch(inputValue($event))"
              placeholder="Search lemmas or forms…"
              aria-label="Search lemmas or forms"
            />
            @if (query().trim()) {
              <div class="search-actions">
                <button
                  type="submit"
                  class="search-add"
                  aria-label="Ask AI"
                  title="Ask AI"
                  [disabled]="asking()"
                  [attr.aria-busy]="asking() ? true : null"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                    />
                  </svg>
                </button>
              </div>
            }
          </form>

          <div class="toolbar-actions">
            <button
              type="button"
              class="toolbar-icon-btn"
              [class.active]="filtersOpen() || filterCount() > 0 || sortActive()"
              [attr.aria-expanded]="filtersOpen()"
              aria-label="Filter and sort"
              title="Filter and sort"
              (click)="openFilters($event)"
            >
              <svg viewBox="0 0 24 24">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              @if (filterCount() > 0) {
                <span class="toolbar-filter-count">{{ filterCount() }}</span>
              }
            </button>
            <button
              type="button"
              class="toolbar-icon-btn"
              [class.active]="grammarOpen()"
              [attr.aria-expanded]="grammarOpen()"
              aria-label="Grammar"
              title="Grammar"
              [disabled]="!code()"
              (click)="openGrammar($event)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 16 6-12 6 12" />
                <path d="M8 12h8" />
                <path d="m16 20 2 2 4-4" />
              </svg>
              @if (openGrammarCount() > 0) {
                <span class="toolbar-filter-count">{{ openGrammarCount() }}</span>
              }
            </button>
          </div>
        </section>

        @if (lookupError()) {
          <p class="lookup-error">{{ lookupError() }}</p>
        }

        @if (ready()) {
          <div class="list-toolbar">
            <p class="list-count">
              @if (code()) {
                <span class="list-language">{{ name() }}</span>
              }
              <span class="count-badge">{{ countLabel() }}</span>
            </p>
            @if (selecting()) {
              <div class="list-toolbar-actions">
                @if (selectedIds().size) {
                  <button
                    type="button"
                    class="list-action danger"
                    aria-label="Delete selected"
                    title="Delete selected"
                    [disabled]="selectionBusy()"
                    (click)="askDeleteSelection()"
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
                <button
                  type="button"
                  class="list-action"
                  aria-label="Select all"
                  title="Select all"
                  [disabled]="selectionBusy() || !shown().length || allShownSelected()"
                  (click)="selectAll()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="list-action"
                  aria-label="Clear selection"
                  title="Clear selection"
                  [disabled]="selectionBusy()"
                  (click)="clearSelection()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            }
          </div>
          @if (selectionError()) {
            <p class="selection-error">{{ selectionError() }}</p>
          }
        } @else {
          <div class="list-toolbar" aria-hidden="true">
            <p class="list-count">
              <span class="bone bone-language"></span>
              <span class="bone bone-count"></span>
            </p>
          </div>
        }
      </div>

      <div class="collection">
        @if (!ready()) {
          <ul class="elements" aria-hidden="true">
            @for (item of skeletons; track item) {
              <li class="card skeleton">
                <div class="element">
                  <span class="bone bone-title"></span>
                  <span class="bone bone-pill"></span>
                </div>
                <div class="stat-rail">
                  <span class="stat-group">
                    <span class="bone bone-stat"></span>
                    <span class="bone bone-stat"></span>
                  </span>
                  <span class="bone bone-score"></span>
                </div>
              </li>
            }
          </ul>
        } @else if (shown().length) {
          <ul class="elements">
            @for (element of shown(); track element.id) {
              @let color = scoreColor(element);
              <li
                class="card"
                [class.selected]="isSelected(element.id)"
                [class.colored]="!!color"
                [style.--score-color]="color"
                (click)="onCardClick(element.id)"
                (contextmenu)="onCardContextMenu($event, element.id)"
                (pointerdown)="onCardPointerDown($event, element.id)"
                (pointermove)="onCardPointerMove($event)"
                (pointerup)="onCardPointerUp()"
                (pointercancel)="onCardPointerUp()"
                (pointerleave)="onCardPointerUp()"
              >
                @let activity = activityTotals(element);
                @let translated = translationCount(element);
                @let pills = leadPills(element);
                <button
                  type="button"
                  class="element"
                  [attr.aria-pressed]="selecting() ? isSelected(element.id) : null"
                >
                  <span class="title">
                    @for (part of highlight(element.title); track $index) {
                      @if (part.hit) {
                        <mark class="hit">{{ part.text }}</mark>
                      } @else {
                        <span>{{ part.text }}</span>
                      }
                    }
                  </span>
                  <span
                    class="pills"
                    [class.colored]="!!leadColor()"
                    [style.--pill-color]="leadColor()"
                  >
                    @if (pills.length) {
                      <span class="pill-label">{{ pillLine(pills) }}</span>
                    }
                  </span>
                </button>
                <div class="stat-rail">
                  <span class="stat-group">
                    @if (activity.worked > 0) {
                      <span
                        class="stat"
                        [attr.aria-label]="workedLabel(activity.worked)"
                        [attr.title]="workedLabel(activity.worked)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999" />
                          <path
                            d="M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024"
                          />
                          <path
                            d="M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069"
                          />
                          <path
                            d="M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z"
                          />
                        </svg>
                        <span>{{ activity.worked }}</span>
                      </span>
                    }
                    @if (activity.reworked > 0) {
                      <span
                        class="stat"
                        [attr.aria-label]="reworkedLabel(activity.reworked)"
                        [attr.title]="reworkedLabel(activity.reworked)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                          />
                        </svg>
                        <span>{{ activity.reworked }}</span>
                      </span>
                    }
                    @if (translated > 0) {
                      <span
                        class="stat"
                        [attr.aria-label]="translatedLabel(translated)"
                        [attr.title]="translatedLabel(translated)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 8 6 6" />
                          <path d="m4 14 6-6 2-3" />
                          <path d="M2 5h12" />
                          <path d="M7 2h1" />
                          <path d="m22 22-5-10-5 10" />
                          <path d="M14 18h6" />
                        </svg>
                        <span>{{ translated }}</span>
                      </span>
                    }
                  </span>
                  @if (scoreLabel(element); as score) {
                    <span
                      class="stat-score"
                      [attr.aria-label]="'Score average ' + score + ' out of 10'"
                    >
                      {{ score }}<span class="stat-score-max">/10</span>
                    </span>
                  } @else {
                    <span
                      class="stat-score unscored"
                      aria-label="Score not available"
                      title="Score not available"
                    >
                      NA
                    </span>
                  }
                </div>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">{{ emptyMessage() }}</p>
        }
      </div>

      @if (discoverOpen() && code()) {
        <app-discover-modal
          [language]="code()"
          [catalog]="metadataCatalog()"
          [elements]="elements()"
          (closed)="closeDiscover()"
          (added)="reloadElements()"
          (open)="openElement($event)"
        />
      }

      @if (grammarOpen()) {
        <div
          class="filter-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Grammar"
          (click)="closeGrammarOnBackdrop($event)"
        >
          <div class="filter-panel" (click)="$event.stopPropagation()">
            <header class="filter-header">
              <div class="filter-heading">
                <h2 class="filter-title">Grammar</h2>
                <button type="button" class="icon-btn" aria-label="Close" (click)="closeGrammar()">
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <p class="filter-subtitle">
                Corrected sentences, newest first. Pick the rules whose words you want to see.
              </p>
            </header>
            <div class="filter-body">
              <section class="grammar-section">
                <h3 class="grammar-heading">Rules</h3>
                @if (grammarMistakes().length) {
                  <div class="grammar-filter-rules">
                    @for (mistake of grammarMistakes(); track mistake.id) {
                      <button
                        type="button"
                        class="grammar-filter-chip"
                        [class.selected]="grammarFiltered(mistake.id)"
                        [class.corrected]="!mistakeOpen(mistake)"
                        [attr.aria-pressed]="grammarFiltered(mistake.id)"
                        (click)="toggleGrammarFilter(mistake.id)"
                      >
                        {{ mistake.rule }}
                      </button>
                    }
                  </div>
                } @else {
                  <p class="empty">No grammar mistakes yet.</p>
                }
              </section>
              <section class="grammar-section">
                <h3 class="grammar-heading">Inputs</h3>
                @if (visibleGrammarInputs().length) {
                  <ul class="grammar-list">
                    @for (input of visibleGrammarInputs(); track input.id) {
                      <li>
                        <span class="grammar-when">{{ grammarTime(input.at) }}</span>
                        <div class="grammar-detail">
                          <p class="grammar-sentence">
                            @for (part of grammarParts(input); track $index) {
                              @if (part.kind === 'fix') {
                                <span class="grammar-mistake" [class.colored]="part.colored">{{
                                  part.wrote
                                }}</span>
                                <span class="grammar-fix" [class.colored]="part.colored">{{
                                  part.correction
                                }}</span>
                              } @else if (part.kind === 'good') {
                                <span class="grammar-good">{{ part.text }}</span>
                              } @else {
                                <span>{{ part.text }}</span>
                              }
                            }
                          </p>
                          @if (input.rules.length) {
                            <div class="grammar-rules">
                              @for (rule of input.rules; track rule.id) {
                                <button
                                  type="button"
                                  class="grammar-rule-btn"
                                  [class.committed]="rule.outcome === 'committed'"
                                  [class.resolved]="rule.outcome === 'resolved'"
                                  [class.selected]="grammarRuleSelected(input.id, rule.id)"
                                  [attr.aria-pressed]="grammarRuleSelected(input.id, rule.id)"
                                  [attr.aria-label]="grammarRuleLabel(rule)"
                                  (click)="toggleGrammarColor(input.id, rule.id)"
                                >
                                  @if (rule.outcome === 'committed') {
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M18 6 6 18" />
                                      <path d="m6 6 12 12" />
                                    </svg>
                                  } @else {
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                  }
                                  <span>{{ rule.rule }}</span>
                                </button>
                              }
                            </div>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="empty">
                    {{
                      grammarFilter().length
                        ? 'No sentences include a selected rule.'
                        : 'No corrected sentences yet.'
                    }}
                  </p>
                }
              </section>
            </div>
            <footer class="filter-footer">
              <button type="button" class="done-btn" (click)="closeGrammar()">Done</button>
            </footer>
          </div>
        </div>
      }

      @if (filtersOpen()) {
        <div
          class="filter-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Filter and sort"
          (click)="closeFiltersOnBackdrop($event)"
        >
          <div class="filter-panel" (click)="$event.stopPropagation()">
            <header class="filter-header">
              <div class="filter-heading">
                <h2 class="filter-title">Filter and sort</h2>
                <button type="button" class="icon-btn" aria-label="Close" (click)="closeFilters()">
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <p class="filter-subtitle">
                Order the list, and keep elements by language, score, or metadata.
              </p>
            </header>

            <div class="filter-body">
              <div class="panel-toolbar">
                <button
                  type="button"
                  class="link-btn"
                  [disabled]="recomputing()"
                  (click)="recomputeMetadata()"
                >
                  {{ recomputing() ? 'Recomputing…' : 'Recompute metadata' }}
                </button>
                <button
                  type="button"
                  class="link-btn"
                  [disabled]="optionalFilterCount() === 0"
                  (click)="clearFilters()"
                >
                  Clear filters
                </button>
              </div>
              @if (recomputeError()) {
                <p class="recompute-error">{{ recomputeError() }}</p>
              }

              <section class="filter-section" [class.expanded]="expanded() === 'sort'">
                <div class="section-header">
                  <button
                    type="button"
                    class="section-toggle"
                    [attr.aria-expanded]="expanded() === 'sort'"
                    (click)="toggleSection('sort')"
                  >
                    <span class="section-title">
                      Sort
                      <span class="section-count">{{ sortLabel() }}</span>
                    </span>
                    <svg class="section-chevron" viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>
                @if (expanded() === 'sort') {
                  <div class="section-body">
                    <div class="sort-options" role="listbox" aria-label="Sort">
                      @for (option of sortOptions; track option.value) {
                        <button
                          type="button"
                          class="sort-option"
                          role="option"
                          [class.selected]="sort() === option.value"
                          [attr.aria-selected]="sort() === option.value"
                          (click)="chooseSort(option.value)"
                        >
                          {{ option.label }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'language'">
                <div class="section-header">
                  <button
                    type="button"
                    class="section-toggle"
                    [attr.aria-expanded]="expanded() === 'language'"
                    (click)="toggleSection('language')"
                  >
                    <span class="section-title">
                      Language
                      @if (code()) {
                        <span class="section-count">{{ name() }}</span>
                      }
                    </span>
                    <svg class="section-chevron" viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>
                @if (expanded() === 'language') {
                  <div class="section-body">
                    <p class="section-hint">Choose one language to continue.</p>
                    <select
                      class="language-select"
                      aria-label="Language"
                      [ngModel]="code()"
                      (ngModelChange)="chooseLanguageValue($event)"
                    >
                      @if (!code()) {
                        <option value="">Choose a language</option>
                      }
                      @for (option of languageOptions; track option) {
                        <option [value]="option">{{ languageName(option) }}</option>
                      }
                    </select>
                    @if (code(); as learning) {
                      <label class="support-field">
                        Support language
                        <select
                          class="language-select"
                          aria-label="Support language"
                          [ngModel]="supportFor(learning)"
                          (ngModelChange)="setSupportLanguage(learning, $event)"
                        >
                          <option value="">None</option>
                          @for (option of supportChoices(learning); track option) {
                            <option [value]="option">{{ languageName(option) }}</option>
                          }
                        </select>
                      </label>
                      <p class="section-hint">
                        Uses the language from Settings, unless you choose another one or none.
                      </p>
                    }
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'score'">
                <div class="section-header">
                  <button
                    type="button"
                    class="section-toggle"
                    [attr.aria-expanded]="expanded() === 'score'"
                    (click)="toggleSection('score')"
                  >
                    <span class="section-title">
                      Score
                      @if (scoreFilterActive()) {
                        <span class="section-count">{{ scoreSummary() }}</span>
                      }
                    </span>
                    <svg class="section-chevron" viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  @if (scoreFilterActive()) {
                    <button type="button" class="link-btn section-clear" (click)="clearScore()">
                      Clear
                    </button>
                  }
                </div>
                @if (expanded() === 'score') {
                  <div class="section-body">
                    <div class="score-values" role="group" aria-label="Score">
                      @for (step of scoreSteps; track step) {
                        <button
                          type="button"
                          class="score-chip"
                          [class.selected]="scoreSelected(step)"
                          [attr.aria-pressed]="scoreSelected(step)"
                          [attr.aria-label]="'Score ' + step"
                          [style.--step-color]="'var(--score-' + step + ')'"
                          [style.--step-bg]="
                            'color-mix(in srgb, var(--score-' + step + ') 14%, transparent)'
                          "
                          (click)="toggleScore(step)"
                        >
                          {{ step }}
                        </button>
                      }
                      <button
                        type="button"
                        class="score-chip unscored"
                        [class.selected]="unscoredFilter()"
                        [attr.aria-pressed]="unscoredFilter()"
                        aria-label="No score"
                        [style.--step-color]="'var(--text-muted)'"
                        [style.--step-bg]="'color-mix(in srgb, var(--text-muted) 14%, transparent)'"
                        (click)="toggleUnscored()"
                      >
                        No score
                      </button>
                    </div>
                  </div>
                }
              </section>

              @for (section of contentSections; track section.id) {
                <section class="filter-section" [class.expanded]="expanded() === section.id">
                  <div class="section-header">
                    <button
                      type="button"
                      class="section-toggle"
                      [attr.aria-expanded]="expanded() === section.id"
                      (click)="toggleSection(section.id)"
                    >
                      <span class="section-title">
                        {{ section.title }}
                        @if (metadataValueCount(section.kind); as selected) {
                          <span class="section-count">{{ selected }}</span>
                        }
                      </span>
                      <svg class="section-chevron" viewBox="0 0 24 24">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    @if (sectionActive(section)) {
                      <button
                        type="button"
                        class="link-btn section-clear"
                        (click)="clearSection(section)"
                      >
                        Clear
                      </button>
                    }
                  </div>
                  @if (expanded() === section.id) {
                    <div class="section-body">
                      @if (metadataEntries(section.kind); as entries) {
                        @if (entries.length) {
                          @for (entry of entries; track entry.key) {
                            <div class="meta-key">
                              <div class="meta-key-head">
                                <span class="bound-label">{{ entry.key }}</span>
                                <input
                                  type="color"
                                  class="meta-color"
                                  [attr.aria-label]="'Color for ' + entry.key"
                                  [value]="fieldColor(section.kind, entry.key) || '#8b90a5'"
                                  (input)="setFieldColor(section.kind, entry.key, $event)"
                                />
                                @if (fieldColor(section.kind, entry.key)) {
                                  <button
                                    type="button"
                                    class="meta-color-clear"
                                    [attr.aria-label]="'Clear color for ' + entry.key"
                                    (click)="clearFieldColor(section.kind, entry.key)"
                                  >
                                    ×
                                  </button>
                                }
                              </div>
                              @let color = fieldColor(section.kind, entry.key);
                              <div class="meta-values" role="group" [attr.aria-label]="entry.key">
                                @for (value of entry.values; track value) {
                                  <button
                                    type="button"
                                    class="meta-value"
                                    [class.colored]="color"
                                    [class.selected]="
                                      metadataSelected(section.kind, entry.key, value)
                                    "
                                    [style.--meta-color]="color"
                                    [attr.aria-pressed]="
                                      metadataSelected(section.kind, entry.key, value)
                                    "
                                    (click)="toggleMetadata(section.kind, entry.key, value)"
                                  >
                                    {{ value }}
                                  </button>
                                }
                              </div>
                            </div>
                          }
                        } @else {
                          <p class="section-hint">{{ section.empty }}</p>
                        }
                      }
                    </div>
                  }
                </section>
              }
            </div>

            <footer class="filter-footer">
              <button type="button" class="done-btn" (click)="closeFilters()">Done</button>
            </footer>
          </div>
        </div>
      }

      @if (deleteConfirm()) {
        <div class="selection-backdrop" (click)="closeDeleteConfirm($event)">
          <section
            class="selection-sheet"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="deleteSelectionTitle()"
            (click)="$event.stopPropagation()"
          >
            <h3>{{ deleteSelectionTitle() }}</h3>
            <p class="selection-hint">{{ selectionConfirmHint() }}</p>
            <div class="selection-actions">
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="selectionBusy()"
                (click)="closeDeleteConfirm($event)"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-danger"
                [disabled]="selectionBusy()"
                (click)="confirmDeleteSelection()"
              >
                Delete
              </button>
            </div>
            @if (selectionError()) {
              <p class="selection-error">{{ selectionError() }}</p>
            }
          </section>
        </div>
      }

      @if (settingsOpen()) {
        <app-settings (closed)="closeSettings()" (changed)="onCollectionReplaced()" />
      }

      @if (statsOpen()) {
        <app-gem-stats
          [language]="code()"
          [asking]="asking()"
          [askError]="statsAskError()"
          (closed)="closeStats()"
          (opened)="openStatsElement($event)"
          (askMissing)="askMissingElement($event)"
        />
      }

      @if (opened(); as element) {
        <app-element-modal
          [element]="element"
          [collection]="elements()"
          [canGoBack]="canGoBack()"
          [definitionIndex]="openedDefinition()"
          [arrivedExample]="arrivedExample()"
          [arrivedGuide]="arrivedGuide()"
          [skipRecall]="skipRecall()"
          (closed)="closeElement()"
          (changed)="replaceElement($event)"
          (deleted)="onElementDeleted()"
          (visit)="visitElement($event)"
          (back)="backElement()"
          (addSelection)="addFromSelection($event)"
          (addPrepared)="addPrepared($event)"
        />
      }

      <footer class="app-bar">
        <nav class="app-bar-row" aria-label="Primary">
          <button
            type="button"
            class="app-bar-btn"
            [class.active]="statsOpen()"
            aria-label="Stats"
            (click)="openStats()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3v16a2 2 0 0 0 2 2h16" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
            <span>Stats</span>
          </button>
          <button
            type="button"
            class="app-bar-btn"
            [class.active]="discoverOpen()"
            [disabled]="!code()"
            aria-label="Discover"
            (click)="openDiscover($event)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
            <span>Discover</span>
          </button>
          <button
            type="button"
            class="app-bar-btn"
            [class.active]="settingsOpen()"
            aria-label="Settings"
            (click)="openSettings()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Settings</span>
          </button>
        </nav>
      </footer>
    </main>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      --bg: #0b0e17;
      --surface: #151928;
      --surface-2: #1b2136;
      --border: rgba(255, 255, 255, 0.08);
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-family: var(--font);
      background: var(--bg);
      color: #e2e8f0;
    }

    main {
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-columns: minmax(0, 1fr);
      overflow: hidden;
      background: var(--bg);
    }

    .page-top {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      padding: calc(1.25rem + env(safe-area-inset-top, 0px)) 1.25rem 0.85rem;
    }

    .collection {
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 0 1.25rem 1.25rem;
      overscroll-behavior: contain;
    }

    .app-bar {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      padding: 0.2rem max(0.85rem, env(safe-area-inset-right, 0px))
        calc(0.2rem + env(safe-area-inset-bottom, 0px)) max(0.85rem, env(safe-area-inset-left, 0px));
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(14, 18, 32, 0.92);
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(18px);
    }

    .app-bar-row {
      display: flex;
      justify-content: space-around;
      align-items: center;
      gap: 0.25rem;
      min-height: 3.6rem;
    }

    .app-bar-btn {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.18rem;
      min-width: 3.4rem;
      padding: 0.3rem 0.35rem;
      border: 0;
      border-radius: 0.7rem;
      background: transparent;
      color: #94a3b8;
      font: inherit;
      font-size: 0.56rem;
      font-weight: 550;
      letter-spacing: -0.01em;
      line-height: 1;
      cursor: pointer;
    }

    .app-bar-btn:hover:not(:disabled) {
      color: white;
    }

    .app-bar-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .app-bar-btn.active {
      color: #ff3366;
      font-weight: 750;
    }

    .app-bar-btn svg {
      width: 1.5rem;
      height: 1.5rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .entries-toolbar {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      margin: 0;
    }

    .toolbar-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex-shrink: 0;
    }

    .toolbar-icon-btn {
      position: relative;
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      background: #151928;
      color: #94a3b8;
      cursor: pointer;
    }

    .toolbar-icon-btn svg,
    .section-chevron,
    .icon-btn svg,
    .list-action svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .toolbar-icon-btn:hover:not(:disabled) {
      color: var(--text);
      border-color: rgba(var(--accent-rgb), 0.4);
    }

    .toolbar-icon-btn.active {
      color: #d8b4fe;
      border-color: rgba(168, 85, 247, 0.35);
      background: #1b2136;
    }

    .toolbar-icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
      color: var(--text-muted);
      border-color: var(--border);
      background: var(--surface);
    }

    .toolbar-filter-count {
      position: absolute;
      top: -0.3rem;
      right: -0.3rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1rem;
      height: 1rem;
      padding: 0 0.22rem;
      border: 2px solid #0b0e17;
      border-radius: 999px;
      background: #a855f7;
      color: white;
      font-size: 0.56rem;
      font-weight: 750;
      line-height: 1;
      pointer-events: none;
    }

    .sort-options {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .sort-option {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text);
      padding: 0.45rem 0.5rem;
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .sort-option:hover {
      background: var(--surface-2);
    }

    .sort-option.selected {
      background: rgba(var(--accent-rgb), 0.14);
      color: var(--accent-text);
      font-weight: 650;
    }

    .list-count {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.15rem;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
    }

    .list-language {
      color: white;
      font-weight: 550;
    }

    .count-badge {
      color: #94a3b8;
      font-weight: 500;
    }

    .list-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 1.15rem;
      margin: 0;
    }

    .list-toolbar .list-count {
      margin: 0;
    }

    .list-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      height: 1.15rem;
    }

    .list-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.9rem;
      height: 1.9rem;
      flex-shrink: 0;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.1);
      color: var(--text-muted);
      cursor: pointer;
      line-height: 1;
    }

    .list-toolbar .list-action {
      width: 1.15rem;
      height: 1.15rem;
      border-radius: 0;
      background: transparent;
    }

    .list-toolbar .list-action svg {
      width: 1rem;
      height: 1rem;
    }

    .list-action:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.18);
      color: var(--text);
    }

    .list-toolbar .list-action:hover:not(:disabled) {
      background: transparent;
      color: var(--text);
    }

    .list-action.active {
      color: var(--text);
      background: rgba(var(--accent-rgb), 0.16);
    }

    .list-toolbar .list-action.active {
      color: var(--accent-text);
      background: transparent;
    }

    .list-action.danger {
      color: var(--danger);
    }

    .list-action:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .selection-error {
      margin: 0.35rem 0 0;
      color: var(--danger);
      font-size: 0.8rem;
    }

    .selection-backdrop {
      position: fixed;
      inset: 0;
      z-index: 36;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
    }

    .selection-sheet {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      width: min(22rem, 100%);
      padding: 1rem 1.1rem 1.1rem;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .selection-sheet h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .selection-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .selection-hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.88rem;
    }

    .selection-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    .selection-actions .btn {
      border-radius: 0.75rem;
    }

    .selection-actions .btn-secondary {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: var(--bg);
    }

    .btn-danger {
      border-radius: 0.75rem;
      background: transparent;
      color: var(--danger);
      border: 1px solid rgba(255, 92, 122, 0.55);
    }

    .btn-danger:hover:not(:disabled) {
      background: rgba(255, 92, 122, 0.12);
    }

    .search-bar {
      position: relative;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex: 1;
      min-width: 0;
      height: 2.55rem;
      min-height: 2.55rem;
      padding: 0 0.35rem 0 2.2rem;
      overflow: hidden;
      background: #151928;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
      transition: border-color 0.15s ease;
    }

    .search-icon {
      position: absolute;
      left: 0.8rem;
      display: grid;
      place-items: center;
      color: #94a3b8;
      pointer-events: none;
    }

    .search-icon svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .search-bar:focus-within {
      border-color: rgba(255, 51, 102, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 51, 102, 0.35);
    }

    .search-bar:focus-within .search-icon {
      color: #ec4899;
    }

    .search-bar:has(input:disabled) {
      opacity: 0.55;
    }

    .search-actions svg {
      display: block;
      width: 0.9rem;
      height: 0.9rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .entry-input {
      flex: 1;
      align-self: stretch;
      min-width: 0;
      height: 100%;
      margin: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      padding: 0 0.35rem;
      font: inherit;
      font-size: 0.75rem;
      line-height: calc(2.55rem - 2px);
      outline: none;
      appearance: none;
    }

    .entry-input::-webkit-search-cancel-button,
    .entry-input::-webkit-search-decoration {
      -webkit-appearance: none;
      appearance: none;
      display: none;
    }

    .entry-input::placeholder {
      color: var(--text-muted);
    }

    .entry-input:disabled {
      cursor: default;
    }

    .search-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      flex-shrink: 0;
    }

    .search-add {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 999px;
      padding: 0;
      line-height: 0;
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      cursor: pointer;
    }

    .search-add:hover:not(:disabled) {
      background: rgba(var(--accent-rgb), 0.28);
    }

    .search-add:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .lookup-error {
      margin: -0.35rem 0 0;
      color: var(--danger);
      font-size: 0.84rem;
    }

    .hit {
      margin: 0;
      padding: 0 0.05em;
      border-radius: 3px;
      background: rgba(232, 200, 135, 0.28);
      color: #f0d9a0;
      font: inherit;
      font-weight: inherit;
    }

    .elements {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding: 0.85rem 0.85rem 0;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: #151928;
      color: inherit;
      cursor: pointer;
      -webkit-touch-callout: none;
      transition: transform 0.16s ease;
    }

    .card:active {
      transform: scale(0.98);
    }

    .card.colored {
      --card-accent: oklch(from var(--score-color) 0.74 calc(min(max(c, 0.16), 0.24)) h);
      border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
      box-shadow: 0 0 16px -2px color-mix(in srgb, var(--card-accent) 45%, transparent);
    }

    .card.selected,
    .card.selected:hover {
      border-color: color-mix(
        in srgb,
        var(--card-accent, var(--score-color, white)) 70%,
        transparent
      );
      box-shadow:
        0 0 16px -2px
          color-mix(in srgb, var(--card-accent, var(--score-color, white)) 45%, transparent),
        inset 0 0 0 1px
          color-mix(in srgb, var(--card-accent, var(--score-color, white)) 55%, transparent);
    }

    .element {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.4rem;
      width: 100%;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      appearance: none;
      user-select: none;
      outline: none;
    }

    .element:focus,
    .element:focus-visible {
      outline: none;
    }

    .title {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      color: white;
      font-size: 1.125rem;
      font-weight: 750;
      line-height: 1.2;
      letter-spacing: -0.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card.colored:hover .title {
      color: var(--card-accent);
    }

    .pills {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      height: 0.85rem;
      overflow: hidden;
      color: var(--text-muted);
      font-size: 0.625rem;
      font-weight: 750;
      letter-spacing: 0.06em;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .pills.colored {
      --pill-accent: oklch(from var(--pill-color) 0.74 calc(min(max(c, 0.16), 0.24)) h);
      color: var(--pill-accent);
    }

    .pill-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stat-rail {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-height: 0.75rem;
      margin-top: 0.7rem;
      padding: 0.55rem 0 0.7rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .stat-group {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 0;
    }

    .stat {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      min-width: 0;
      height: 0.75rem;
      color: #cbd5e1;
      font-size: 0.625rem;
      font-weight: 550;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .stat > span {
      display: block;
      line-height: 1;
      transform: translateY(0.5px);
    }

    .stat svg {
      display: block;
      width: 0.75rem;
      height: 0.75rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      color: var(--card-accent, #94a3b8);
    }

    .stat-score {
      flex: none;
      margin-left: auto;
      color: var(--card-accent);
      font-size: 0.95rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .stat-score-max {
      color: color-mix(in srgb, var(--card-accent) 65%, var(--text-muted));
      font-size: 0.68rem;
      font-weight: 650;
    }

    .stat-score.unscored {
      color: var(--text-muted);
      font-weight: 650;
      letter-spacing: 0.02em;
    }

    .card.skeleton {
      border-color: rgba(255, 255, 255, 0.06);
      box-shadow: none;
      pointer-events: none;
      cursor: default;
    }

    .card.skeleton:active {
      transform: none;
    }

    .bone {
      display: block;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 10%, transparent);
    }

    .list-count .bone-language {
      width: 4.5rem;
      height: 0.75rem;
    }

    .list-count .bone-count {
      width: 4.75rem;
      height: 0.75rem;
    }

    .skeleton .bone-title {
      width: 62%;
      height: calc(1.125rem * 1.2);
    }

    .skeleton .bone-pill {
      width: 42%;
      height: 0.85rem;
    }

    .skeleton .bone-stat {
      width: 1.6rem;
      height: 0.75rem;
    }

    .skeleton .bone-score {
      width: 2.4rem;
      height: 0.95rem;
      margin-left: auto;
    }

    .empty {
      margin: 0.4rem 0 0;
      color: var(--muted);
    }

    .filter-backdrop {
      position: fixed;
      inset: 0;
      z-index: 35;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: hidden;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
    }

    .filter-panel {
      box-sizing: border-box;
      width: min(520px, 100%);
      height: calc(100dvh - 2.5rem);
      max-height: calc(100dvh - 2.5rem);
      margin-top: auto;
      margin-bottom: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .filter-header,
    .filter-footer {
      display: flex;
      flex-shrink: 0;
    }

    .filter-header {
      flex-direction: column;
      align-items: stretch;
      gap: 0.3rem;
      padding: 0.75rem 1.15rem 0.7rem;
      border-bottom: 1px solid var(--border);
    }

    .filter-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .filter-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }

    .filter-subtitle {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.8rem;
      height: 1.8rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover {
      background: rgba(139, 144, 165, 0.16);
      color: var(--text);
    }

    .filter-body {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: auto;
      padding: 1rem 1.15rem 1.15rem;
    }

    .grammar-list {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .grammar-list li {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 0.75rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
    }

    .grammar-section {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .grammar-heading {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .grammar-rule-btn {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .grammar-when {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .grammar-detail {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .grammar-filter-rules {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .grammar-filter-chip {
      width: auto;
      padding: 0.28rem 0.55rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-2);
      color: inherit;
      font: inherit;
      font-weight: 650;
      line-height: 1.3;
      text-align: left;
      cursor: pointer;
    }

    .grammar-filter-chip.selected {
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .grammar-filter-chip.corrected {
      opacity: 0.72;
    }

    .grammar-rules {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.45rem 0 0;
    }

    .grammar-rule-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      width: auto;
      padding: 0.28rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      line-height: 1.3;
    }

    .grammar-rule-btn svg {
      display: block;
      flex: none;
      width: 0.72rem;
      height: 0.72rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .grammar-rule-btn.committed svg {
      color: var(--danger);
    }

    .grammar-rule-btn.resolved svg {
      color: var(--gem-green);
    }

    .grammar-rule-btn.selected {
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .grammar-sentence {
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .grammar-mistake {
      color: var(--text-muted);
      text-decoration: line-through;
    }

    .grammar-mistake.colored {
      color: var(--danger);
      font-weight: 650;
    }

    .grammar-fix {
      margin-left: 0.28rem;
    }

    .grammar-fix.colored {
      color: var(--gem-green);
      font-weight: 650;
    }

    .grammar-good {
      color: var(--gem-green);
      font-weight: 650;
    }

    .panel-toolbar {
      display: flex;
      flex-shrink: 0;
      justify-content: space-between;
      gap: 0.5rem 0.75rem;
      flex-wrap: wrap;
    }

    .recompute-error {
      flex-shrink: 0;
      margin: 0;
      color: var(--danger);
      font-size: 0.78rem;
    }

    .filter-section {
      flex-shrink: 0;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
    }

    .section-header {
      position: relative;
      display: flex;
      align-items: center;
    }

    .section-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      padding: 0.85rem;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .section-clear {
      position: absolute;
      top: 50%;
      right: 2.35rem;
      z-index: 1;
      transform: translateY(-50%);
    }

    .section-header:has(.section-clear) .section-title {
      padding-right: 3rem;
    }

    .section-title {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
      min-width: 0;
      font-size: 0.92rem;
      font-weight: 700;
    }

    .section-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: auto;
      padding: 0.15rem 0.45rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.5rem;
      background: rgba(255, 255, 255, 0.04);
      color: #94a3b8;
      font-size: 0.68rem;
      font-weight: 650;
      letter-spacing: 0.02em;
    }

    .section-chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.18s ease;
    }

    .filter-section.expanded .section-chevron {
      transform: rotate(180deg);
    }

    .section-body {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0 0.75rem 0.85rem;
    }

    .section-hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.78rem;
      line-height: 1.4;
    }

    .bound-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }

    .language-select {
      width: 100%;
      padding: 0.7rem 0.85rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      background: var(--bg);
      color: var(--text);
      font: inherit;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
    }

    .language-select:focus {
      outline: none;
      border-color: rgba(255, 51, 102, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 51, 102, 0.35);
    }

    .support-field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.55rem;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }

    .score-values {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.3rem;
      padding-top: 0.2rem;
    }

    .score-chip {
      border: 0;
      border-radius: 0.65rem;
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      padding: 0.4rem 0;
      color: color-mix(in srgb, var(--step-color) 75%, var(--text-muted));
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      text-align: center;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
      user-select: none;
    }

    .score-chip:hover {
      color: var(--step-color);
      background: var(--step-bg);
    }

    .score-chip.selected {
      background: var(--step-bg);
      color: var(--step-color);
      font-weight: 750;
      box-shadow: inset 0 0 0 1.5px var(--step-color);
    }

    .score-chip.unscored {
      grid-column: 1 / -1;
    }

    .score-chip.unscored:hover {
      color: var(--text);
    }

    .score-chip.unscored.selected {
      color: var(--text);
      box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--text) 45%, var(--border));
    }

    .meta-key {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.2rem;
    }

    .meta-key-head {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .meta-color {
      width: 1.45rem;
      height: 1.35rem;
      padding: 0.1rem;
      border: 1px solid var(--border);
      border-radius: 0.35rem;
      background: var(--surface);
      cursor: pointer;
    }

    .meta-color-clear {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 0 0.15rem;
      font: inherit;
      font-size: 0.95rem;
      line-height: 1;
      cursor: pointer;
    }

    .meta-values {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .meta-value {
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 999px;
      background: var(--bg);
      color: var(--text);
      padding: 0.35rem 0.7rem;
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      cursor: pointer;
    }

    .meta-value:hover {
      background: rgba(127, 127, 127, 0.1);
    }

    .meta-value.selected {
      background: var(--accent-soft);
      color: var(--accent-text);
      border-color: var(--accent-border);
    }

    .meta-value.colored,
    .meta-value.colored:hover,
    .meta-value.colored.selected {
      color: var(--text);
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--meta-color);
    }

    .meta-value.colored.selected {
      box-shadow: inset 0 0 0 2px var(--meta-color);
    }

    .link-btn {
      border: 0;
      background: transparent;
      color: var(--accent-text);
      font: inherit;
      font-size: 0.76rem;
      font-weight: 650;
      cursor: pointer;
      padding: 0.2rem 0.3rem;
      border-radius: 0.35rem;
    }

    .link-btn:hover:not(:disabled) {
      background: rgba(var(--accent-rgb), 0.1);
    }

    .link-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .filter-footer {
      justify-content: flex-end;
      padding: 0.85rem 1.15rem 1.15rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    }

    .done-btn {
      border: 0;
      border-radius: 0.75rem;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      color: white;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 650;
      padding: 0.65rem 1.15rem;
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
      cursor: pointer;
    }

    .done-btn:hover {
      opacity: 0.95;
    }

    @media (max-width: 720px) {
      .elements {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .filter-backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .filter-panel {
        width: 100%;
        height: calc(100dvh - 1.3rem);
        max-height: calc(100dvh - 1.3rem);
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class LanguagePage {
  private loadId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressStartX = 0;
  private pressStartY = 0;
  private swallowClickUntil = 0;
  private scrollLock = '';
  private scrollLocked = false;
  private promptedLanguage = false;
  private readonly statsJob = inject(GemStatsJob);

  readonly languageOptions = LEARNABLE_LANGUAGES;
  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly asking = signal(false);
  readonly discoverOpen = signal(false);
  readonly lookupError = signal('');
  readonly statsAskError = signal('');
  readonly selecting = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectionBusy = signal(false);
  readonly selectionError = signal('');
  readonly deleteConfirm = signal(false);
  readonly skeletons = ELEMENT_SKELETONS;
  readonly sortOptions: { value: ElementSort; label: string }[] = [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'created-desc', label: 'Most recent' },
    { value: 'created-asc', label: 'Least recent' },
    { value: 'definitions-desc', label: 'Most definitions' },
    { value: 'translations-desc', label: 'Most translations' },
    { value: 'gems-desc', label: 'Most gems' },
    { value: 'gems-asc', label: 'Least gems' },
  ];
  readonly code = signal('');
  private translationLanguage = '';
  private translationCache = new Map<string, number>();
  /** Lifetime translation unveils per element, from the compiled stats snapshot. */
  private readonly translationTotals = computed(() => {
    const language = this.code();
    const view = this.statsJob.view(language);
    const snapshot = view.phase === 'ready' ? view.snapshot : null;
    if (!snapshot) return language === this.translationLanguage ? this.translationCache : new Map();
    const totals = new Map<string, number>();
    for (const day of snapshot.days) {
      for (const element of day.elements) {
        if (!element.revealed) continue;
        totals.set(element.id, (totals.get(element.id) ?? 0) + element.revealed);
      }
    }
    this.translationLanguage = language;
    this.translationCache = totals;
    return totals;
  });
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly leadFieldKey = signal(readDefinitionMetadataFields()[0]?.key ?? '');
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly sort = signal<ElementSort>(DEFAULT_ELEMENT_SORT);
  readonly contentSections: readonly ContentSection[] = [
    {
      id: 'definitions',
      kind: 'definitions',
      title: 'Definitions',
      empty: 'No definition metadata yet. Recompute to collect it.',
    },
    {
      id: 'examples',
      kind: 'examples',
      title: 'Examples',
      empty: 'No example metadata yet. Recompute to collect it.',
    },
    {
      id: 'forms',
      kind: 'forms',
      title: 'Forms',
      empty: 'No form metadata yet. Recompute to collect it.',
    },
  ];
  readonly scoreSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly scoreFilter = signal<number[]>([]);
  readonly unscoredFilter = signal(false);
  readonly definitionMetaFilter = signal<ElementMetadataVariability>({});
  readonly exampleMetaFilter = signal<ElementMetadataVariability>({});
  readonly formMetaFilter = signal<ElementMetadataVariability>({});
  readonly metadataCatalog = signal<ElementCatalog>(emptyElementCatalog());
  readonly recomputing = signal(false);
  readonly recomputeError = signal('');
  readonly filtersOpen = signal(false);
  readonly grammarOpen = signal(false);
  readonly grammarInputs = signal<GrammarInput[]>([]);
  readonly grammarFilter = signal<string[]>([]);
  readonly grammarColor = signal<{ inputId: string; ruleIds: string[] } | null>(null);
  readonly grammarMistakes = computed(() => grammarRules(this.grammarInputs()));
  readonly visibleGrammarInputs = computed(() => {
    const filter = this.grammarFilter();
    const rows = this.grammarInputs();
    if (!filter.length) return rows;
    return rows.filter((input) => filter.some((id) => input.rules.some((rule) => rule.id === id)));
  });
  readonly openGrammarCount = computed(
    () => this.grammarMistakes().filter((mistake) => grammarMistakeOpen(mistake)).length,
  );
  readonly settingsOpen = signal(false);
  readonly statsOpen = signal(false);
  readonly expanded = signal<FilterSection | null>('definitions');
  readonly elementId = signal('');
  /** True only while the open element was just created. */
  readonly skipRecall = signal(false);
  readonly trail = signal<ElementTrailStop[]>([]);
  readonly canGoBack = computed(() => this.trail().length > 1);
  readonly openedDefinition = computed(() => this.trail().at(-1)?.definition ?? 0);
  readonly arrivedExample = computed(() => this.trail().at(-1)?.example?.trim() ?? '');
  readonly arrivedGuide = computed(() => this.trail().at(-1)?.guide?.trim() ?? '');
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly optionalFilterCount = computed(
    () =>
      this.scoreFilter().length +
      (this.unscoredFilter() ? 1 : 0) +
      metadataFilterSize(this.definitionMetaFilter()) +
      metadataFilterSize(this.exampleMetaFilter()) +
      metadataFilterSize(this.formMetaFilter()),
  );
  readonly filterCount = computed(() => (this.code() ? 1 : 0) + this.optionalFilterCount());
  readonly sortActive = computed(() => {
    const sort = this.sort();
    return sort !== DEFAULT_ELEMENT_SORT && sort !== 'none';
  });
  readonly visible = computed(() => {
    const search = this.search();
    const score = this.scoreFilter();
    const unscored = this.unscoredFilter();
    const definitionMeta = this.definitionMetaFilter();
    const exampleMeta = this.exampleMetaFilter();
    const formMeta = this.formMetaFilter();
    const source = this.elements();
    const matched = source.filter((element) => {
      if (search.mode === 'prefix' && !elementMatchesPrefix(element, search.value)) return false;
      if (!elementMatchesScore(element, score, unscored)) return false;
      return elementMatchesMetadata(element, definitionMeta, exampleMeta, formMeta);
    });
    return matched.slice().sort((left, right) => compareElements(left, right, this.sort()));
  });
  readonly shown = computed(() => this.visible());
  readonly countLabel = computed(() => {
    if (this.selecting()) {
      const count = this.selectedIds().size;
      return count === 1 ? '1 selected' : `${count} selected`;
    }
    const count = this.shown().length;
    return count === 1 ? '1 element' : `${count} elements`;
  });
  readonly allShownSelected = computed(() => {
    const shown = this.shown();
    if (!shown.length) return false;
    const selected = this.selectedIds();
    return shown.every((element) => selected.has(element.id));
  });
  readonly emptyMessage = computed(() => {
    if (!this.code()) return 'Select a language to continue.';
    if (!this.elements().length) return 'No elements yet.';
    return 'No matching elements.';
  });

  constructor() {
    effect(() => {
      const language = this.code();
      untracked(() => {
        if (language) this.statsJob.ensure(language);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.clearPressTimer();
      if (this.overlayOpen()) this.unlockScroll(true);
    });
    void this.loadCatalog();
    void this.load(ensureSelectedLanguage() ?? '');
  }

  @HostListener('document:click', ['$event'])
  dismissSelectionFromDocument(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    this.dismissSelectionFromOutside(target);
  }

  @HostListener('document:keydown.escape')
  closeMenusOnEscape(): void {
    if (this.settingsOpen()) {
      this.closeSettings();
      return;
    }
    if (this.statsOpen()) {
      this.closeStats();
      return;
    }
    if (this.discoverOpen()) {
      if (!this.elementId()) this.closeDiscover();
      return;
    }
    if (this.grammarOpen()) {
      this.closeGrammar();
      return;
    }
    if (this.filtersOpen()) {
      this.closeFilters();
      return;
    }
    if (this.elementId() || this.selectionBusy()) return;
    if (this.deleteConfirm()) {
      this.deleteConfirm.set(false);
      return;
    }
    if (this.selecting()) {
      this.clearSelection();
    }
  }

  openElement(id: string): void {
    if (!id) return;
    this.skipRecall.set(false);
    this.trail.set([{ id, definition: 0 }]);
    this.showElement(id);
  }

  openCard(id: string): void {
    this.openElement(id);
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  onCardClick(id: string): void {
    if (Date.now() < this.swallowClickUntil) {
      this.swallowClickUntil = 0;
      return;
    }
    if (this.selecting()) {
      this.toggleSelected(id);
      return;
    }
    this.openCard(id);
  }

  onCardContextMenu(event: Event, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.selecting()) {
      if (!this.selectedIds().has(id)) this.toggleSelected(id);
      return;
    }
    this.beginSelection(id);
  }

  onCardPointerDown(event: PointerEvent, id: string): void {
    if (this.selecting() || this.selectionBusy()) return;
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    this.clearPressTimer();
    this.pressStartX = event.clientX;
    this.pressStartY = event.clientY;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.beginSelection(id);
    }, LONG_PRESS_MS);
  }

  onCardPointerMove(event: PointerEvent): void {
    if (this.pressTimer == null) return;
    const dx = event.clientX - this.pressStartX;
    const dy = event.clientY - this.pressStartY;
    if (dx * dx + dy * dy > MOVE_SLOP_PX * MOVE_SLOP_PX) this.clearPressTimer();
  }

  onCardPointerUp(): void {
    this.clearPressTimer();
  }

  selectAll(): void {
    if (this.selectionBusy()) return;
    const ids = this.shown()
      .map((element) => element.id)
      .filter((id) => id);
    if (!ids.length || ids.every((id) => this.selectedIds().has(id))) return;
    const next = new Set(this.selectedIds());
    for (const id of ids) next.add(id);
    this.selectedIds.set(next);
    this.selecting.set(true);
  }

  clearSelection(): void {
    this.clearPressTimer();
    this.selecting.set(false);
    this.selectedIds.set(new Set());
    this.deleteConfirm.set(false);
    this.selectionError.set('');
  }

  askDeleteSelection(): void {
    if (this.selectionBusy() || this.selectedIds().size === 0) return;
    this.deleteConfirm.set(true);
  }

  closeDeleteConfirm(event?: Event): void {
    event?.stopPropagation();
    if (this.selectionBusy()) return;
    this.deleteConfirm.set(false);
  }

  deleteSelectionTitle(): string {
    const count = this.selectedIds().size;
    return count === 1 ? 'Delete this element?' : `Delete ${count} elements?`;
  }

  selectionConfirmHint(): string {
    return this.selectedIds().size === 1
      ? 'If you delete all the history, this element is lost. Stats are recomputed.'
      : 'If you delete all the history, these elements are lost. Stats are recomputed.';
  }

  async confirmDeleteSelection(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length || this.selectionBusy()) return;
    this.selectionBusy.set(true);
    this.selectionError.set('');
    try {
      await Promise.all(ids.map((id) => deleteElement(id)));
      this.applyCatalog(await readMetadataCatalog());
      const gone = new Set(ids);
      this.elements.update((list) => list.filter((item) => !gone.has(item.id)));
      if (gone.has(this.elementId())) this.closeElement();
      this.clearSelection();
    } catch {
      this.selectionError.set('Could not delete these elements.');
    } finally {
      this.selectionBusy.set(false);
    }
  }

  private beginSelection(id: string): void {
    if (this.selectionBusy() || !id) return;
    this.swallowClickUntil = Date.now() + 400;
    this.selecting.set(true);
    this.selectedIds.update((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  private dropSelected(id: string): void {
    if (!this.selectedIds().has(id)) return;
    const next = new Set(this.selectedIds());
    next.delete(id);
    if (next.size === 0) {
      this.clearSelection();
      return;
    }
    this.selectedIds.set(next);
  }

  private toggleSelected(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) {
      this.clearSelection();
      return;
    }
    this.selectedIds.set(next);
  }

  private dismissSelectionFromOutside(target: Element | null): void {
    if (this.selectionBusy() || !this.selecting()) return;
    if (this.deleteConfirm()) return;
    if (
      target?.closest(
        '.card, .element, .list-toolbar-actions, .selection-backdrop, app-element-modal',
      )
    ) {
      return;
    }
    this.clearSelection();
  }

  private clearPressTimer(): void {
    if (this.pressTimer == null) return;
    clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  private selectedElements(): StoredElement[] {
    const ids = this.selectedIds();
    return this.elements().filter((element) => ids.has(element.id));
  }

  private async writeSelected(patch: (element: StoredElement) => StoredElement): Promise<boolean> {
    const current = this.selectedElements();
    if (!current.length || this.selectionBusy()) return false;
    const language = current[0]?.language;
    this.selectionBusy.set(true);
    this.selectionError.set('');
    try {
      const saved = await Promise.all(current.map((element) => saveElement(patch(element))));
      if (this.code() !== language) return false;
      const byId = new Map(saved.map((item) => [item.id, item]));
      this.elements.update((list) => list.map((item) => byId.get(item.id) ?? item));
      this.applyCatalog(await readMetadataCatalog());
      return true;
    } catch {
      this.selectionError.set('Could not update these elements.');
      return false;
    } finally {
      this.selectionBusy.set(false);
    }
  }

  visitElement(
    visit: { id: string; definition: number; example?: string; guide?: string },
    fresh = false,
  ): void {
    const id = visit.id;
    if (!id || id === this.elementId()) return;
    const example = visit.example?.trim() ?? '';
    const guide = visit.guide?.replace(/\s+/g, ' ').trim() ?? '';
    this.trail.update((trail) => {
      const next = trail.slice();
      const current = next.at(-1);
      if (current) next[next.length - 1] = { ...current, definition: visit.definition };
      next.push({
        id,
        definition: 0,
        ...(example ? { example } : {}),
        ...(guide ? { guide } : {}),
      });
      return next;
    });
    this.skipRecall.set(fresh);
    this.showElement(id);
  }

  backElement(): void {
    const trail = this.trail();
    if (trail.length < 2) return;
    const next = trail.slice(0, -1);
    this.trail.set(next);
    this.skipRecall.set(true);
    this.showElement(next.at(-1)?.id ?? '');
  }

  async addFromSelection(pick: {
    title: string;
    language: string;
    definition: number;
    example?: string;
    guide?: string;
    done?: (saved: boolean) => void;
  }): Promise<void> {
    const finish = (saved: boolean) => pick.done?.(saved);
    const name = pick.title.replace(/\s+/g, ' ').trim();
    const code = pick.language.trim().toLowerCase();
    if (!name || !code) {
      finish(false);
      return;
    }
    try {
      const started = Date.now();
      const created = await addElement(code, name);
      if (code === this.code()) this.elements.set(await readElements(code));
      if (created.id !== this.elementId()) {
        this.visitElement(
          {
            id: created.id,
            definition: pick.definition,
            example: pick.example,
            guide: pick.guide,
          },
          created.createdAt >= started,
        );
      }
      finish(true);
    } catch {
      finish(false);
    }
  }

  async addPrepared(
    prepared: {
      title: string;
      language?: string;
      definitions: Array<ElementDefinition & { equivalent?: string }>;
      example?: string;
      guide?: string;
      definition?: number;
    },
    fromSearch = false,
  ): Promise<void> {
    const name = prepared.title.replace(/\s+/g, ' ').trim();
    const code = (prepared.language || this.code()).trim().toLowerCase();
    if (!name || !code) return;
    const example = prepared.example?.replace(/\s+/g, ' ').trim() ?? '';
    const started = Date.now();
    let created = await addElement(code, name);
    const fresh = created.createdAt >= started;
    if (!created.definitions.length && prepared.definitions.length) {
      const attached = sensesWithEquivalents(
        created.equivalents,
        supportLanguageFor(code),
        prepared.definitions,
      );
      created = await saveElement({
        ...created,
        definitions: attached.senses,
        equivalents: attached.equivalents,
      });
    }
    if (this.code() === code) this.elements.set(await readElements(code));
    this.applyCatalog(await readMetadataCatalog());
    if (fromSearch) {
      this.clearSearch();
      this.trail.set([{ id: created.id, definition: 0 }]);
      this.skipRecall.set(fresh);
      this.showElement(created.id);
      return;
    }
    if (created.id === this.elementId()) return;
    this.visitElement(
      {
        id: created.id,
        definition: prepared.definition ?? 0,
        example,
        guide: prepared.guide,
      },
      fresh,
    );
  }

  replaceElement(saved: StoredElement): void {
    this.elements.update((list) =>
      list.some((item) => item.id === saved.id)
        ? list.map((item) => (item.id === saved.id ? saved : item))
        : [...list, saved],
    );
    void this.refreshCatalog();
  }

  onElementDeleted(): void {
    const id = this.elementId();
    if (id) {
      this.elements.update((list) => list.filter((item) => item.id !== id));
      this.dropSelected(id);
    }
    void this.refreshCatalog();
    this.closeElement();
  }

  closeElement(): void {
    if (!this.elementId()) return;
    this.trail.set([]);
    this.showElement(null);
    void this.refreshGrammar();
  }

  private showElement(id: string | null): void {
    this.elementId.set(id ?? '');
    if (!id) this.trail.set([]);
  }

  highlight(text: string): ElementSearchPart[] {
    return elementHighlightParts(displayTitle(text, this.code()), this.search());
  }

  leadPills(element: StoredElement): LeadValue[] {
    return compiledLeadValues(element, this.leadFieldKey());
  }

  /** CSS color for this element's score, or null when it has not been scored. */
  scoreColor(element: StoredElement): string | null {
    const step = elementScoreStep(element);
    return step == null ? null : `var(--score-${step})`;
  }

  /** Average out of 10, or null when this element has not been scored. */
  scoreLabel(element: StoredElement): string | null {
    const average = definitionScoreAverage(element);
    return average == null ? null : average.toFixed(1);
  }

  /** Color of the metadata field shown under the title. The element color stays off this line. */
  leadColor(): string | null {
    return this.fieldColor('definitions', this.leadFieldKey());
  }

  pillLine(pills: LeadValue[]): string {
    return pills.map((pill) => pill.value).join(' · ');
  }

  activityTotals(element: StoredElement): { worked: number; reworked: number } {
    let worked = 0;
    let reworked = 0;
    for (const entry of element.log) {
      if (entry.event === 'rework') reworked += 1;
      else if (entry.event === 'game') worked += 1;
    }
    return { worked, reworked };
  }

  workedLabel(count: number): string {
    if (count === 0) return 'Not worked';
    return count === 1 ? 'Worked once' : `Worked ${count} times`;
  }

  reworkedLabel(count: number): string {
    if (count === 0) return 'Not reworked';
    return count === 1 ? 'Reworked once' : `Reworked ${count} times`;
  }

  /** Lifetime unveils of this element or one of its forms. */
  translationCount(element: StoredElement): number {
    return this.translationTotals().get(element.id) ?? 0;
  }

  translatedLabel(count: number): string {
    if (count === 0) return 'Not translated';
    return count === 1 ? 'Translated once' : `Translated ${count} times`;
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onSearch(value: string): void {
    const query = value.slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    this.query.set(query);
    this.lookupError.set('');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.commitSearch(), 250);
  }

  async askFromSearch(event?: Event): Promise<void> {
    event?.preventDefault();
    const selected = this.query().trim();
    const code = this.code();
    if (!selected || !code || this.asking()) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.asking.set(true);
    this.lookupError.set('');
    try {
      const generated = await this.elementFromQuery(code, selected);
      if (!generated) {
        await this.openBareElement(code, selected);
        return;
      }
      await this.addPrepared(
        {
          title: generated.lemma,
          definitions: generated.definitions.map((sense) => ({
            text: sense.text,
            equivalent: sense.equivalent,
            equivalentIds: {},
            forms: searchForms(generated.lemma, selected),
            examples: sense.example ? [{ text: sense.example, metadata: {} }] : [],
            metadata: { ...sense.metadata },
          })),
        },
        true,
      );
    } catch {
      this.lookupError.set('Could not add that element.');
    } finally {
      this.asking.set(false);
    }
  }

  private async elementFromQuery(language: string, selected: string) {
    try {
      return await generateElementFromSelection({
        language,
        selected,
        translation: this.translationTarget(),
      });
    } catch {
      return null;
    }
  }

  private async openBareElement(code: string, title: string): Promise<void> {
    const started = Date.now();
    const created = await addElement(code, title);
    this.elements.set(await readElements(code));
    this.clearSearch();
    this.trail.set([{ id: created.id, definition: 0 }]);
    this.skipRecall.set(created.createdAt >= started);
    this.showElement(created.id);
  }

  private clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.query.set('');
    this.search.set(elementPrefixSearch(''));
  }

  sortLabel(): string {
    return this.sortOptions.find((option) => option.value === this.sort())?.label ?? 'None';
  }

  chooseSort(sort: ElementSort): void {
    this.sort.set(this.sort() === sort ? 'none' : sort);
  }

  openDiscover(event: Event): void {
    event.stopPropagation();
    if (!this.code()) return;
    if (this.filtersOpen()) this.closeFilters();
    if (this.grammarOpen()) this.closeGrammar();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) this.closeStats();
    if (this.discoverOpen()) return;
    this.discoverOpen.set(true);
    this.lockScroll();
  }

  closeDiscover(): void {
    if (!this.discoverOpen()) return;
    this.discoverOpen.set(false);
    this.unlockScroll();
  }

  async reloadElements(): Promise<void> {
    const code = this.code();
    if (!code) return;
    const [elements, catalog] = await Promise.all([readElements(code), readMetadataCatalog()]);
    if (this.code() !== code) return;
    this.elements.set(elements);
    this.applyCatalog(catalog);
  }

  mistakeOpen(mistake: GrammarMistake): boolean {
    return grammarMistakeOpen(mistake);
  }

  grammarRuleSelected(inputId: string, ruleId: string): boolean {
    const color = this.grammarColor();
    return color?.inputId === inputId && color.ruleIds.includes(ruleId);
  }

  grammarRuleLabel(rule: GrammarInputRule): string {
    const status = rule.outcome === 'committed' ? 'Error committed' : 'Corrected';
    return `${status}: ${rule.rule}`;
  }

  toggleGrammarColor(inputId: string, ruleId: string): void {
    const current = this.grammarColor();
    const ids = current?.inputId === inputId ? current.ruleIds : [];
    const next = ids.includes(ruleId) ? ids.filter((id) => id !== ruleId) : [...ids, ruleId];
    this.grammarColor.set(next.length ? { inputId, ruleIds: next } : null);
  }

  grammarFiltered(id: string): boolean {
    return this.grammarFilter().includes(id);
  }

  toggleGrammarFilter(id: string): void {
    const current = this.grammarFilter();
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    this.grammarFilter.set(next);
    const color = this.grammarColor();
    if (color && !this.visibleGrammarInputs().some((input) => input.id === color.inputId)) {
      this.grammarColor.set(null);
    }
  }

  grammarParts(input: GrammarInput): GrammarMark[] {
    const color = this.grammarColor();
    const selected = new Set(color?.inputId === input.id ? color.ruleIds : []);
    return grammarCorrectionMarks(
      input.after,
      input.rules
        .filter((rule) => selected.has(rule.id))
        .map((rule) => ({
          instances: rule.instances,
          colored: true,
          followed: rule.outcome === 'resolved',
        })),
    );
  }

  grammarTime(at: number): string {
    return new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  openGrammar(event: Event): void {
    event.stopPropagation();
    if (!this.code()) return;
    if (this.discoverOpen()) this.closeDiscover();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) this.closeStats();
    if (this.filtersOpen()) this.closeFilters();
    this.grammarOpen.set(true);
    this.lockScroll();
    void this.refreshGrammar();
  }

  closeGrammar(): void {
    if (!this.grammarOpen()) return;
    this.grammarOpen.set(false);
    this.unlockScroll();
  }

  closeGrammarOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeGrammar();
  }

  openFilters(event: Event): void {
    event.stopPropagation();
    if (this.discoverOpen()) this.closeDiscover();
    if (this.grammarOpen()) this.closeGrammar();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) this.closeStats();
    this.expanded.set(this.code() ? 'definitions' : 'language');
    this.filtersOpen.set(true);
    this.lockScroll();
  }

  closeFilters(): void {
    if (!this.filtersOpen()) return;
    this.filtersOpen.set(false);
    this.unlockScroll();
  }

  closeFiltersOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeFilters();
  }

  toggleSection(section: FilterSection): void {
    this.expanded.update((current) => (current === section ? null : section));
  }

  scoreSelected(step: number): boolean {
    return this.scoreFilter().includes(step);
  }

  scoreFilterActive(): boolean {
    return this.scoreFilter().length > 0 || this.unscoredFilter();
  }

  scoreSummary(): string {
    return String(this.scoreFilter().length + (this.unscoredFilter() ? 1 : 0));
  }

  toggleScore(step: number): void {
    const current = this.scoreFilter();
    const next = current.includes(step)
      ? current.filter((item) => item !== step)
      : [...current, step];
    this.scoreFilter.set(next);
  }

  toggleUnscored(): void {
    this.unscoredFilter.update((selected) => !selected);
  }

  clearScore(): void {
    this.scoreFilter.set([]);
    this.unscoredFilter.set(false);
  }

  clearFilters(): void {
    this.scoreFilter.set([]);
    this.unscoredFilter.set(false);
    this.definitionMetaFilter.set({});
    this.exampleMetaFilter.set({});
    this.formMetaFilter.set({});
  }

  metadataEntries(kind: MetadataKind): { key: string; values: string[] }[] {
    const shown = mergeMetadataVariability(this.catalogFor(kind), this.metadataFilter(kind));
    return Object.entries(shown).map(([key, values]) => ({ key, values }));
  }

  metadataValueCount(kind: MetadataKind): number {
    return Object.values(this.metadataFilter(kind)).reduce((sum, values) => sum + values.length, 0);
  }

  metadataSelected(kind: MetadataKind, key: string, value: string): boolean {
    return (this.metadataFilter(kind)[key] ?? []).includes(value);
  }

  fieldColor(kind: MetadataKind, key: string): string | null {
    return readFieldColor(kind, key);
  }

  setFieldColor(kind: MetadataKind, key: string, event: Event): void {
    writeFieldColor(kind, key, (event.target as HTMLInputElement).value);
  }

  clearFieldColor(kind: MetadataKind, key: string): void {
    writeFieldColor(kind, key, null);
  }

  toggleMetadata(kind: MetadataKind, key: string, value: string): void {
    const current = this.metadataFilter(kind);
    const values = current[key] ?? [];
    const nextValues = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    const next = { ...current };
    if (nextValues.length) next[key] = nextValues;
    else delete next[key];
    this.setMetadataFilter(kind, next);
  }

  sectionActive(section: ContentSection): boolean {
    return this.metadataValueCount(section.kind) > 0;
  }

  clearSection(section: ContentSection): void {
    this.setMetadataFilter(section.kind, {});
  }

  languageName(code: string): string {
    return languageDisplayName(code);
  }

  private translationTarget(): string {
    return supportLanguageFor(this.code());
  }

  supportFor(learning: string): string {
    return supportLanguageFor(learning);
  }

  supportChoices(learning: string): readonly string[] {
    return this.languageOptions.filter((code) => code !== learning);
  }

  setSupportLanguage(learning: string, value: string): void {
    writeSupportLanguage(learning, value);
  }

  chooseLanguageValue(value: string): void {
    if (!isLearnableLanguage(value) || value === this.code()) return;
    writeSelectedLanguage(value);
    void this.load(value);
  }

  openSettings(): void {
    if (this.filtersOpen()) this.closeFilters();
    if (this.grammarOpen()) this.closeGrammar();
    if (this.discoverOpen()) this.closeDiscover();
    if (this.statsOpen()) this.closeStats();
    if (this.settingsOpen()) return;
    this.settingsOpen.set(true);
    this.lockScroll();
  }

  closeSettings(): void {
    if (!this.settingsOpen()) return;
    this.settingsOpen.set(false);
    this.unlockScroll();
    this.refreshLeadField();
  }

  onCollectionReplaced(): void {
    if (this.elementId()) this.closeElement();
    this.refreshLeadField();
    void this.reloadElements();
  }

  openStats(): void {
    if (this.filtersOpen()) this.closeFilters();
    if (this.grammarOpen()) this.closeGrammar();
    if (this.discoverOpen()) this.closeDiscover();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) return;
    this.statsAskError.set('');
    this.statsOpen.set(true);
    this.lockScroll();
  }

  closeStats(): void {
    if (!this.statsOpen()) return;
    this.statsOpen.set(false);
    this.statsAskError.set('');
    this.unlockScroll();
  }

  openStatsElement(id: string): void {
    this.closeStats();
    this.openElement(id);
  }

  async askMissingElement(title: string): Promise<void> {
    const selected = title.replace(/\s+/g, ' ').trim();
    const code = this.code();
    if (!selected || !code || this.asking()) return;
    this.asking.set(true);
    this.statsAskError.set('');
    try {
      const generated = await this.elementFromQuery(code, selected);
      if (!generated) {
        await this.openBareElement(code, selected);
        this.closeStats();
        return;
      }
      await this.addPrepared(
        {
          title: generated.lemma,
          definitions: generated.definitions.map((sense) => ({
            text: sense.text,
            equivalent: sense.equivalent,
            equivalentIds: {},
            forms: searchForms(generated.lemma, selected),
            examples: sense.example ? [{ text: sense.example, metadata: {} }] : [],
            metadata: { ...sense.metadata },
          })),
        },
        true,
      );
      this.closeStats();
    } catch {
      this.statsAskError.set('Could not add that element.');
    } finally {
      this.asking.set(false);
    }
  }

  async recomputeMetadata(): Promise<void> {
    if (this.recomputing()) return;
    this.recomputing.set(true);
    this.recomputeError.set('');
    try {
      const all = await readAllElements();
      const next: StoredElement[] = [];
      for (const element of all) {
        next.push(await saveElement(element, { syncCatalog: false }));
      }
      const catalog = await commitElementCatalog(catalogFromElements(next));
      const code = this.code();
      if (code) this.elements.set(next.filter((element) => element.language === code));
      this.applyCatalog(catalog);
    } catch {
      this.recomputeError.set('Could not recompute metadata.');
    } finally {
      this.recomputing.set(false);
    }
  }

  private async loadCatalog(): Promise<void> {
    this.applyCatalog(await readMetadataCatalog());
  }

  private async refreshCatalog(): Promise<void> {
    this.applyCatalog(await readMetadataCatalog());
  }

  private applyCatalog(catalog: ElementCatalog): void {
    this.metadataCatalog.set(catalog);
  }

  private async load(language: string): Promise<void> {
    const seq = ++this.loadId;
    const code = language.trim().toLowerCase();
    this.clearSelection();
    if (this.discoverOpen()) this.closeDiscover();
    if (this.grammarOpen()) this.closeGrammar();
    this.elementId.set('');
    this.trail.set([]);
    if (!isLearnableLanguage(code)) {
      this.code.set('');
      this.name.set('');
      this.elements.set([]);
      this.clearGrammar();
      this.ready.set(true);
      if (!this.promptedLanguage) {
        this.promptedLanguage = true;
        this.expanded.set('language');
        this.filtersOpen.set(true);
        this.lockScroll();
      }
      return;
    }
    this.code.set(code);
    this.name.set(languageDisplayName(code));
    this.clearGrammar();
    this.ready.set(false);
    const [elements, grammar] = await Promise.all([
      readElements(code),
      readGrammarInputs(code).catch(() => [] as GrammarInput[]),
    ]);
    if (seq !== this.loadId) return;
    this.elements.set(elements);
    this.grammarInputs.set(grammar);
    this.ready.set(true);
  }

  private refreshLeadField(): void {
    this.leadFieldKey.set(readDefinitionMetadataFields()[0]?.key ?? '');
  }

  private clearGrammar(): void {
    this.grammarInputs.set([]);
    this.grammarFilter.set([]);
    this.grammarColor.set(null);
  }

  private async refreshGrammar(): Promise<void> {
    const code = this.code();
    if (!isLearnableLanguage(code)) {
      this.clearGrammar();
      return;
    }
    try {
      const rows = await readGrammarInputs(code);
      if (this.code() !== code) return;
      this.grammarInputs.set(rows);
      const color = this.grammarColor();
      if (color && !rows.some((input) => input.id === color.inputId)) {
        this.grammarColor.set(null);
      }
    } catch {
      if (this.code() === code) this.clearGrammar();
    }
  }

  private overlayOpen(): boolean {
    return (
      this.filtersOpen() ||
      this.grammarOpen() ||
      this.settingsOpen() ||
      this.statsOpen() ||
      this.discoverOpen()
    );
  }

  private lockScroll(): void {
    if (this.scrollLocked) return;
    this.scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.scrollLocked = true;
  }

  private unlockScroll(force = false): void {
    if (!force && this.overlayOpen()) return;
    if (!this.scrollLocked) return;
    document.body.style.overflow = this.scrollLock;
    this.scrollLock = '';
    this.scrollLocked = false;
  }

  private metadataFilter(kind: MetadataKind): ElementMetadataVariability {
    if (kind === 'definitions') return this.definitionMetaFilter();
    if (kind === 'examples') return this.exampleMetaFilter();
    return this.formMetaFilter();
  }

  private catalogFor(kind: MetadataKind): ElementMetadataVariability {
    const metadata = this.metadataCatalog();
    if (kind === 'definitions') return metadata.definitionMetadata;
    if (kind === 'examples') return metadata.exampleMetadata;
    return metadata.formMetadata;
  }

  private setMetadataFilter(kind: MetadataKind, filter: ElementMetadataVariability): void {
    const next = parseMetadataFilter(formatMetadataFilter(filter));
    if (kind === 'definitions') this.definitionMetaFilter.set(next);
    else if (kind === 'examples') this.exampleMetaFilter.set(next);
    else this.formMetaFilter.set(next);
  }

  private commitSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.search.set(elementPrefixSearch(this.query()));
  }
}

function searchForms(lemma: string, selected: string): ElementDefinition['forms'] {
  const forms: ElementDefinition['forms'] = [];
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
