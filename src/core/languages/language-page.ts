import {
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { ElementModal } from '../elements/element-modal';
import { GemStatsModal } from '../elements/gem-stats-modal';
import { ModeIcon } from '../elements/mode-icon';
import { ScoreGauge } from '../elements/score-gauge';
import { readFieldColor, writeFieldColor } from '../elements/metadata-colors';
import { COMFORT_RATES, comfortColor } from '../elements/comfort-palette';
import { DiscoverModal } from './discover-modal';
import { ensureSelectedLanguage, writeSelectedLanguage } from './selected-language';
import { translationInto } from './translation-language';
import { Settings } from '../settings/settings';
import { generateElementFromSelection } from 'ai';
import {
  addElement,
  compareElements,
  DEFAULT_ELEMENT_SORT,
  deleteElement,
  displayTitle,
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesCountRanges,
  elementMatchesMetadata,
  elementMatchesComfort,
  elementMatchesMode,
  elementMatchesPrefix,
  elementModeLabel,
  elementPrefixSearch,
  emptyMetadataIndexes,
  formatMetadataFilter,
  isLearnableLanguage,
  isValidForm,
  LEARNABLE_LANGUAGES,
  languageDisplayName,
  mergeMetadataIndexes,
  mergeMetadataVariability,
  metadataFilterSize,
  parseMetadataFilter,
  readAllElements,
  readElements,
  readMetadataCatalog,
  replaceMetadataCatalog,
  saveElement,
  setCountRangeBound,
  stepCountRange,
  type ElementCountRange,
  type ElementDefinition,
  type ElementLogEntry,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
  type ElementMode,
  type ElementSearch,
  type ElementSearchPart,
  type ElementSort,
  type StoredElement,
} from 'collection';

type FilterSection =
  'language' | 'mode' | 'comfort' | 'translations' | 'definitions' | 'examples' | 'forms';

type MetadataKind = 'definitions' | 'examples' | 'forms';

type ContentSection = {
  id: 'definitions' | 'examples' | 'forms';
  kind: MetadataKind;
  title: string;
  count: 'definitions' | null;
  empty: string;
};

const ELEMENT_SKELETONS = [0, 1, 2, 3, 4, 5, 6, 7];
const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 10;

@Component({
  selector: 'app-language-page',
  imports: [ElementModal, ModeIcon, ScoreGauge, DiscoverModal, Settings, GemStatsModal],
  template: `
    <main>
      <div class="page-top">
        <section class="entries-toolbar" aria-label="Search">
          <form class="search-bar" autocomplete="off" (submit)="lookup($event)">
            <input
              class="entry-input"
              type="search"
              autocomplete="off"
              [value]="query()"
              [attr.maxlength]="maxSearchLength"
              [disabled]="playing() || !code()"
              (input)="onSearch(inputValue($event))"
              placeholder="Search lemmas or forms…"
              aria-label="Search lemmas or forms"
            />
            @if (query().trim()) {
              <div class="search-actions">
                <button
                  type="button"
                  class="search-add"
                  [attr.aria-label]="askLabel()"
                  [attr.title]="askLabel()"
                  [disabled]="asking() || playing()"
                  [attr.aria-busy]="asking() ? true : null"
                  (click)="askFromSearch()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                    />
                  </svg>
                </button>
                <button
                  type="submit"
                  class="search-add"
                  aria-label="Add entry"
                  [disabled]="asking() || playing()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                </button>
              </div>
            }
          </form>

          <div class="toolbar-actions">
            <button
              type="button"
              class="toolbar-icon-btn"
              [class.active]="discoverOpen()"
              [disabled]="playing() || !code()"
              aria-label="Discover"
              title="Discover"
              (click)="openDiscover($event)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
            </button>
            <button
              type="button"
              class="toolbar-icon-btn"
              [class.active]="filtersOpen() || filterCount() > 0"
              [attr.aria-expanded]="filtersOpen()"
              aria-label="Filter collection"
              title="Filter"
              (click)="openFilters($event)"
            >
              <svg viewBox="0 0 24 24">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              @if (filterCount() > 0) {
                <span class="toolbar-filter-count">{{ filterCount() }}</span>
              }
            </button>

            <div class="toolbar-menu">
              <button
                type="button"
                class="toolbar-icon-btn"
                [class.active]="sortOpen() || sortActive()"
                [attr.aria-expanded]="sortOpen()"
                [disabled]="playing() || !code()"
                aria-label="Sort collection"
                title="Sort"
                (click)="toggleSort($event)"
              >
                <svg viewBox="0 0 24 24">
                  <path d="m3 8 4-4 4 4" />
                  <path d="M7 4v16" />
                  <path d="m21 16-4 4-4-4" />
                  <path d="M17 20V4" />
                </svg>
              </button>
              @if (sortOpen() && !playing()) {
                <div
                  class="toolbar-popover"
                  role="listbox"
                  aria-label="Sort collection"
                  (click)="$event.stopPropagation()"
                >
                  @for (option of sortOptions(); track option.value) {
                    <button
                      type="button"
                      class="popover-option"
                      role="option"
                      [class.selected]="sort() === option.value"
                      [attr.aria-selected]="sort() === option.value"
                      (click)="chooseSort(option.value)"
                    >
                      {{ option.label }}
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        </section>

        @if (lookupError()) {
          <p class="lookup-error">{{ lookupError() }}</p>
        }
      </div>

      <div class="collection">
        @if (ready()) {
          <div class="list-toolbar">
            <p class="list-count">
              @if (code()) {
                <span class="list-language">{{ name() }}</span>
              }
              <span>{{ countLabel() }}</span>
            </p>
            @if (selecting()) {
              <div class="list-toolbar-actions">
                @if (selectedIds().size) {
                  <button
                    type="button"
                    class="list-action"
                    [class.active]="comfortOpen()"
                    aria-label="Set comfort"
                    title="Set comfort"
                    [disabled]="selectionBusy()"
                    (click)="openSelectionComfort()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="6" />
                      <circle cx="12" cy="12" r="2" />
                    </svg>
                  </button>
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
          <p class="list-count" aria-hidden="true"><span class="bone bone-count"></span></p>
        }

        @if (!ready()) {
          <ul class="elements" aria-hidden="true">
            @for (item of skeletons; track item) {
              <li>
                <div class="element skeleton">
                  <div class="element-body">
                    <span class="bone bone-title"></span>
                  </div>
                  <span class="bone bone-icons"></span>
                  <span class="bone bone-track"></span>
                </div>
              </li>
            }
          </ul>
        } @else if (shown().length) {
          <ul class="elements">
            @for (element of shown(); track element.id) {
              <li>
                <button
                  type="button"
                  class="element"
                  [class.playing]="playing()"
                  [class.selected]="isSelected(element.id)"
                  [style.--score-color]="comfortColor(element.comfort)"
                  [attr.aria-pressed]="selecting() ? isSelected(element.id) : null"
                  (click)="onCardClick(element.id)"
                  (contextmenu)="onCardContextMenu($event, element.id)"
                  (pointerdown)="onCardPointerDown($event, element.id)"
                  (pointermove)="onCardPointerMove($event)"
                  (pointerup)="onCardPointerUp()"
                  (pointercancel)="onCardPointerUp()"
                  (pointerleave)="onCardPointerUp()"
                >
                  <div class="element-body">
                    @if (playing()) {
                      @if (element.mode; as mode) {
                        <span class="play-mark">
                          <span class="play-icon" [attr.aria-label]="modeLabel(mode)">
                            <app-mode-icon [mode]="mode" />
                          </span>
                        </span>
                      }
                    } @else {
                      <span class="title-line">
                        <span class="title">
                          @for (part of highlight(element.title); track $index) {
                            @if (part.hit) {
                              <mark class="hit">{{ part.text }}</mark>
                            } @else {
                              <span>{{ part.text }}</span>
                            }
                          }
                        </span>
                      </span>
                    }
                  </div>
                  <div class="card-icons">
                    <span
                      class="stat"
                      [class.quiet]="!element.equivalents.length"
                      [attr.aria-label]="
                        element.equivalents.length === 1
                          ? '1 translation'
                          : element.equivalents.length + ' translations'
                      "
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m5 8 6 6" />
                        <path d="m4 14 6-6 2-3" />
                        <path d="M2 5h12" />
                        <path d="M7 2h1" />
                        <path d="m22 22-5-10-5 10" />
                        <path d="M14 18h6" />
                      </svg>
                      <span>{{ element.equivalents.length }}</span>
                    </span>
                    <span
                      class="stat"
                      [class.quiet]="!element.definitions.length"
                      [attr.aria-label]="definitionsLabel(element.definitions.length)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
                        />
                        <path d="m8 13 4-7 4 7" />
                        <path d="M9.1 11h5.7" />
                      </svg>
                      <span>{{ element.definitions.length }}</span>
                    </span>
                    @if (element.clicks > 0) {
                      <span class="stat" [attr.aria-label]="clicksLabel(element.clicks)">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{{ element.clicks }}</span>
                      </span>
                    }
                    @if (modeGem(element); as total) {
                      <span
                        class="card-gem"
                        [attr.data-game]="total.game"
                        [attr.aria-label]="gemsLabel(total.game, total.gems)"
                      >
                        <span class="gem" aria-hidden="true"></span>
                        <span>{{ total.gems }}</span>
                      </span>
                    }
                  </div>
                  <div
                    class="comfort-track"
                    role="img"
                    [attr.aria-label]="'Comfort ' + element.comfort + ' of 10'"
                  >
                    @for (rate of comfortRates; track rate) {
                      <span class="comfort-mark" [class.filled]="rate <= element.comfort"></span>
                    }
                  </div>
                </button>
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

      @if (filtersOpen()) {
        <div
          class="filter-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          (click)="closeFiltersOnBackdrop($event)"
        >
          <div class="filter-panel" (click)="$event.stopPropagation()">
            <header class="filter-header">
              <div>
                <h2 class="filter-title">Filters</h2>
                <p class="filter-subtitle">
                  Keep elements by language, mode, comfort, counts, or metadata.
                </p>
              </div>
              <button type="button" class="icon-btn" aria-label="Close" (click)="closeFilters()">
                <svg viewBox="0 0 24 24">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
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

              <section class="filter-section" [class.expanded]="expanded() === 'language'">
                <button
                  type="button"
                  class="section-header"
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
                @if (expanded() === 'language') {
                  <div class="section-body">
                    <p class="section-hint">Choose one language to continue.</p>
                    <select
                      class="language-select"
                      aria-label="Language"
                      [value]="code()"
                      (change)="chooseLanguageValue($event)"
                    >
                      @if (!code()) {
                        <option value="">Choose a language</option>
                      }
                      @for (option of languageOptions; track option) {
                        <option [value]="option">{{ languageName(option) }}</option>
                      }
                    </select>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'mode'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'mode'"
                  (click)="toggleSection('mode')"
                >
                  <span class="section-title">
                    Mode
                    @if (modeFilter().length) {
                      <span class="section-count">{{ modeSummary() }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'mode') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="modeFilter().length === 0"
                        (click)="clearMode()"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">Show elements in any selected mode.</p>
                    <div class="mode-choices" role="group" aria-label="Mode">
                      @for (mode of modes; track mode) {
                        <button
                          type="button"
                          class="mode-choice"
                          [attr.data-mode]="mode"
                          [class.selected]="modeSelected(mode)"
                          [attr.aria-pressed]="modeSelected(mode)"
                          (click)="chooseMode(mode)"
                        >
                          <app-mode-icon [mode]="mode" />
                          <span>{{ modeLabel(mode) }}</span>
                        </button>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'comfort'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'comfort'"
                  (click)="toggleSection('comfort')"
                >
                  <span class="section-title">
                    Comfort
                    @if (comfortFilter().length) {
                      <span class="section-count">{{ comfortSummary() }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'comfort') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="comfortFilter().length === 0"
                        (click)="clearComfort()"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">Show elements at any selected comfort rate.</p>
                    <div class="comfort-choices" role="group" aria-label="Comfort">
                      @for (rate of comfortRates; track rate) {
                        <button
                          type="button"
                          class="comfort-choice"
                          [class.selected]="comfortSelected(rate)"
                          [attr.aria-pressed]="comfortSelected(rate)"
                          [style.--rate-color]="comfortColor(rate)"
                          (click)="chooseComfort(rate)"
                        >
                          {{ rate }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'translations'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'translations'"
                  (click)="toggleSection('translations')"
                >
                  <span class="section-title">
                    Translations
                    @if (rangeSummary(translationRange()); as summary) {
                      <span class="section-count">{{ summary }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'translations') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="!rangeActive(translationRange())"
                        (click)="clearRange('translations')"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">Keep a translation count inside this range.</p>
                    <div class="count-range">
                      <div class="bound">
                        <span class="bound-label">From</span>
                        <div class="count-stepper">
                          <button
                            type="button"
                            aria-label="Decrease minimum translations"
                            [disabled]="!canStep('translations', 'min', -1)"
                            (click)="stepBound('translations', 'min', -1)"
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputmode="numeric"
                            aria-label="Minimum translations"
                            [value]="boundValue(translationRange().min)"
                            (change)="commitBound('translations', 'min', $event)"
                          />
                          <button
                            type="button"
                            aria-label="Increase minimum translations"
                            [disabled]="!canStep('translations', 'min', 1)"
                            (click)="stepBound('translations', 'min', 1)"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <span class="range-sep" aria-hidden="true">–</span>
                      <div class="bound">
                        <span class="bound-label">To</span>
                        <div class="count-stepper">
                          <button
                            type="button"
                            aria-label="Decrease maximum translations"
                            [disabled]="!canStep('translations', 'max', -1)"
                            (click)="stepBound('translations', 'max', -1)"
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputmode="numeric"
                            aria-label="Maximum translations"
                            placeholder="Any"
                            [value]="boundValue(translationRange().max)"
                            (change)="commitBound('translations', 'max', $event)"
                          />
                          <button
                            type="button"
                            aria-label="Increase maximum translations"
                            [disabled]="!canStep('translations', 'max', 1)"
                            (click)="stepBound('translations', 'max', 1)"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              </section>

              @for (section of contentSections; track section.id) {
                <section class="filter-section" [class.expanded]="expanded() === section.id">
                  <button
                    type="button"
                    class="section-header"
                    [attr.aria-expanded]="expanded() === section.id"
                    (click)="toggleSection(section.id)"
                  >
                    <span class="section-title">
                      {{ section.title }}
                      @if (section.count && rangeSummary(definitionRange()); as summary) {
                        <span class="section-count">{{ summary }}</span>
                      }
                      @if (metadataValueCount(section.kind); as selected) {
                        <span class="section-count">{{ selected }}</span>
                      }
                    </span>
                    <svg class="section-chevron" viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  @if (expanded() === section.id) {
                    <div class="section-body">
                      <div class="section-actions">
                        <button
                          type="button"
                          class="link-btn"
                          [disabled]="!sectionActive(section)"
                          (click)="clearSection(section)"
                        >
                          Clear
                        </button>
                      </div>
                      @if (section.count) {
                        <p class="section-hint">Keep a definition count inside this range.</p>
                        <div class="count-range">
                          <div class="bound">
                            <span class="bound-label">From</span>
                            <div class="count-stepper">
                              <button
                                type="button"
                                aria-label="Decrease minimum definitions"
                                [disabled]="!canStep('definitions', 'min', -1)"
                                (click)="stepBound('definitions', 'min', -1)"
                              >
                                −
                              </button>
                              <input
                                type="text"
                                inputmode="numeric"
                                aria-label="Minimum definitions"
                                [value]="boundValue(definitionRange().min)"
                                (change)="commitBound('definitions', 'min', $event)"
                              />
                              <button
                                type="button"
                                aria-label="Increase minimum definitions"
                                [disabled]="!canStep('definitions', 'min', 1)"
                                (click)="stepBound('definitions', 'min', 1)"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <span class="range-sep" aria-hidden="true">–</span>
                          <div class="bound">
                            <span class="bound-label">To</span>
                            <div class="count-stepper">
                              <button
                                type="button"
                                aria-label="Decrease maximum definitions"
                                [disabled]="!canStep('definitions', 'max', -1)"
                                (click)="stepBound('definitions', 'max', -1)"
                              >
                                −
                              </button>
                              <input
                                type="text"
                                inputmode="numeric"
                                aria-label="Maximum definitions"
                                placeholder="Any"
                                [value]="boundValue(definitionRange().max)"
                                (change)="commitBound('definitions', 'max', $event)"
                              />
                              <button
                                type="button"
                                aria-label="Increase maximum definitions"
                                [disabled]="!canStep('definitions', 'max', 1)"
                                (click)="stepBound('definitions', 'max', 1)"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      }
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

      @if (comfortOpen()) {
        <div class="selection-backdrop" (click)="closeComfortSheet($event)">
          <section
            class="selection-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Comfort"
            (click)="$event.stopPropagation()"
          >
            <div class="selection-head">
              <h3>Comfort</h3>
              <button
                type="button"
                class="list-action"
                aria-label="Close"
                [disabled]="selectionBusy()"
                (click)="closeComfortSheet($event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div class="comfort-stepper" role="group" aria-label="Comfort">
              <button
                type="button"
                class="comfort-step"
                aria-label="Lower comfort"
                [disabled]="selectionBusy() || comfortDraft() <= 1"
                (click)="stepSelectionComfort(-1)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <app-score-gauge [score]="comfortDraft()" size="md" />
              <button
                type="button"
                class="comfort-step"
                aria-label="Raise comfort"
                [disabled]="selectionBusy() || comfortDraft() >= 10"
                (click)="stepSelectionComfort(1)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
              </button>
            </div>
            @if (selectionError()) {
              <p class="selection-error">{{ selectionError() }}</p>
            }
          </section>
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
            <p class="selection-hint">
              {{
                selectedIds().size === 1
                  ? 'This element will be removed.'
                  : 'These elements will be removed.'
              }}
            </p>
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
        <app-settings (closed)="closeSettings()" />
      }

      @if (statsOpen()) {
        <app-gem-stats (closed)="closeStats()" />
      }

      @if (opened(); as element) {
        <app-element-modal
          [element]="element"
          [collection]="elements()"
          [canGoBack]="canGoBack()"
          [playing]="playing() && element.id === playId()"
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
        <div class="app-bar-row">
          <button
            type="button"
            class="app-bar-btn"
            [class.active]="statsOpen()"
            aria-label="Stats"
            title="Stats"
            (click)="openStats()"
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
            class="app-bar-btn mode"
            [class.active]="playing()"
            [disabled]="!code()"
            [attr.aria-pressed]="playing()"
            [attr.aria-label]="playing() ? 'Playing, switch to working' : 'Working, switch to play'"
            [attr.title]="playing() ? 'Playing, switch to working' : 'Working, switch to play'"
            (click)="togglePlay()"
          >
            @if (playing()) {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="8 5 19 12 8 19 8 5" />
              </svg>
            } @else {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                />
                <path d="m15 5 4 4" />
              </svg>
            }
          </button>
          <button
            type="button"
            class="app-bar-btn"
            [class.active]="settingsOpen()"
            aria-label="Settings"
            title="Settings"
            (click)="openSettings()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </footer>
    </main>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    main {
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-columns: minmax(0, 1fr);
      overflow: hidden;
    }

    .page-top {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 1.25rem 0.55rem;
    }

    .collection {
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 0.15rem 1.25rem 1.25rem;
      overscroll-behavior: contain;
    }

    .app-bar {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      padding: 0.35rem max(0.85rem, env(safe-area-inset-right, 0px))
        calc(0.15rem + env(safe-area-inset-bottom, 0px))
        max(0.85rem, env(safe-area-inset-left, 0px));
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 92%, transparent);
    }

    .app-bar-row {
      display: flex;
      justify-content: center;
      align-items: flex-end;
      min-height: 3.7rem;
    }

    .app-bar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .app-bar-btn.mode {
      width: 3.25rem;
      height: 3.25rem;
      margin-bottom: 0.35rem;
    }

    .app-bar-btn:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .app-bar-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .app-bar-btn.active {
      color: var(--accent-text);
      background: rgba(var(--accent-rgb), 0.16);
    }

    .app-bar-btn svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .app-bar-btn.mode svg {
      width: 1.65rem;
      height: 1.65rem;
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

    .toolbar-menu {
      position: relative;
    }

    .toolbar-icon-btn {
      position: relative;
      display: grid;
      place-items: center;
      width: 2.4rem;
      height: 2.4rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text-muted);
      cursor: pointer;
    }

    .toolbar-icon-btn svg,
    .section-chevron,
    .icon-btn svg,
    .list-action svg,
    .comfort-step svg {
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
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
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
      top: -0.35rem;
      right: -0.35rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.05rem;
      height: 1.05rem;
      padding: 0 0.28rem;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font-size: 0.62rem;
      font-weight: 750;
      line-height: 1;
      pointer-events: none;
      box-shadow: 0 0 0 1.5px var(--surface);
    }

    .toolbar-popover {
      position: absolute;
      top: calc(100% + 0.35rem);
      right: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 14.5rem;
      padding: 0.55rem;
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      background: var(--surface);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
    }

    .popover-option {
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

    .popover-option:hover {
      background: var(--surface-2);
    }

    .popover-option.selected {
      background: rgba(var(--accent-rgb), 0.14);
      color: var(--accent-text);
      font-weight: 650;
    }

    .list-count {
      display: flex;
      align-items: baseline;
      gap: 0.65rem;
      margin: 0;
      font-size: 0.78rem;
      line-height: 1.15rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .list-language {
      color: var(--text);
      font-weight: 650;
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
      background: rgba(8, 10, 16, 0.55);
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
      font-size: 1rem;
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

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid rgba(255, 92, 122, 0.55);
    }

    .btn-danger:hover:not(:disabled) {
      background: rgba(255, 92, 122, 0.12);
    }

    .comfort-stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.1rem;
    }

    .comfort-step {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.4rem;
      height: 2.4rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }

    .comfort-step:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .search-bar {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex: 1;
      min-width: 0;
      height: 2.4rem;
      min-height: 2.4rem;
      padding: 0 0.2rem 0 0.15rem;
      overflow: hidden;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.15s ease;
    }

    .search-bar:focus-within {
      border-color: rgba(var(--accent-rgb), 0.55);
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
      padding: 0 0.75rem;
      font: inherit;
      font-size: 0.9rem;
      line-height: calc(2.4rem - 2px);
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
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .elements > li {
      display: flex;
      min-width: 0;
    }

    .element {
      box-sizing: border-box;
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      min-height: 4.8rem;
      padding: 0;
      overflow: hidden;
      --level-line: color-mix(in srgb, var(--score-color, var(--border)) 42%, var(--border));
      border: 1px solid var(--level-line);
      border-radius: 0;
      background: color-mix(in srgb, var(--score-color, transparent) 12%, var(--surface));
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      -webkit-touch-callout: none;
    }

    .element-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      justify-content: flex-start;
      gap: 0.35rem;
      min-width: 0;
      padding: 0.55rem 0.75rem;
    }

    .card-icons {
      box-sizing: border-box;
      display: flex;
      flex: none;
      align-items: center;
      justify-content: flex-end;
      gap: 0.85rem;
      width: 100%;
      padding: 0.15rem 0.75rem 0.45rem;
    }

    .element:hover {
      background: color-mix(in srgb, var(--score-color, transparent) 18%, var(--surface));
    }

    .element.selected,
    .element.selected:hover {
      --level-line: color-mix(in srgb, var(--score-color, var(--text)) 72%, white);
      border-color: var(--level-line);
      background: color-mix(in srgb, var(--score-color, transparent) 30%, var(--surface));
      box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--score-color, var(--text)) 55%, transparent);
    }

    .card-gem {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.16rem;
      color: var(--exercise-gem);
      font-size: 0.78rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .card-gem[data-game='translation'] {
      --exercise-gem: var(--gem-translation);
    }

    .card-gem[data-game='example'] {
      --exercise-gem: var(--gem-example);
    }

    .card-gem[data-game='definition'] {
      --exercise-gem: var(--gem-definition);
    }

    .card-gem .gem {
      --gem-size: 0.85rem;
      background: var(--exercise-gem);
    }

    .comfort-track {
      display: flex;
      box-sizing: border-box;
      width: 100%;
      margin-top: auto;
      gap: 2px;
      border-top: 1px solid var(--level-line, var(--border));
      background: var(--level-line, var(--border));
    }

    .comfort-mark {
      flex: 1 1 0;
      min-width: 0;
      height: 0.48rem;
      background: color-mix(in srgb, var(--text) 16%, color-mix(in srgb, #000 55%, var(--surface)));
    }

    .comfort-mark.filled {
      background: var(--score-color, var(--text));
    }

    .title-line {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
    }

    .title {
      min-width: 0;
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.02em;
    }

    .element.playing .element-body {
      align-items: center;
    }

    .play-mark {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      line-height: 1;
      cursor: pointer;
    }

    .play-icon {
      display: grid;
      place-items: center;
      width: 2.15rem;
      height: 2.15rem;
      color: var(--text);
    }

    .play-icon app-mode-icon {
      width: 100%;
      height: 100%;
    }

    .stat {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.18rem;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .stat.quiet {
      opacity: 0.4;
    }

    .stat svg {
      display: block;
      width: 0.85rem;
      height: 0.85rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .skeleton {
      border-color: color-mix(in srgb, var(--text) 7%, transparent);
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      pointer-events: none;
    }

    .bone {
      display: block;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 10%, transparent);
    }

    .list-count .bone-count {
      display: inline-block;
      width: 5.5rem;
      height: 0.72em;
      vertical-align: -0.08em;
    }

    .skeleton .bone-icons {
      width: 6.5rem;
      height: 0.75rem;
      margin: 0.2rem 0.75rem 0.45rem;
    }

    .skeleton .bone-title {
      width: 58%;
      height: 1.05rem;
    }

    .skeleton .bone-track {
      width: 100%;
      height: 0.48rem;
      margin: 0;
      border-radius: 0;
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
      overflow: auto;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .filter-panel {
      box-sizing: border-box;
      width: min(520px, 100%);
      max-height: calc(100dvh - 2.5rem);
      margin-top: auto;
      margin-bottom: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .filter-header,
    .filter-footer {
      display: flex;
      flex-shrink: 0;
    }

    .filter-header {
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
    }

    .filter-title {
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .filter-subtitle {
      margin: 0.4rem 0 0;
      max-width: 28rem;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.15rem;
      height: 2.15rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.1);
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover {
      background: rgba(127, 127, 127, 0.18);
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
      border-radius: 0.9rem;
      background: color-mix(in srgb, var(--surface) 70%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .section-header {
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
      height: 1.25rem;
      padding: 0 0.35rem;
      border-radius: 999px;
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      font-size: 0.68rem;
      font-weight: 750;
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

    .section-actions {
      display: flex;
      justify-content: flex-end;
    }

    .section-hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.78rem;
      line-height: 1.4;
    }

    .count-range {
      display: flex;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.15rem;
    }

    .bound {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
    }

    .bound-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }

    .range-sep {
      padding-bottom: 0.4rem;
      color: var(--text-muted);
      font-weight: 700;
    }

    .count-stepper {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .count-stepper button {
      display: grid;
      place-items: center;
      width: 1.8rem;
      height: 1.8rem;
      border: 0;
      border-radius: 0.55rem;
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      color: var(--text);
      font: inherit;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .count-stepper button:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.1);
    }

    .count-stepper button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .count-stepper input {
      width: 2.7rem;
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.84rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      padding: 0;
    }

    .count-stepper input::placeholder {
      color: var(--text-muted);
      font-weight: 650;
    }

    .count-stepper input:focus {
      outline: 2px solid rgba(var(--accent-rgb), 0.55);
      outline-offset: 2px;
      border-radius: 0.2rem;
    }

    .language-select {
      width: 100%;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    .mode-choices {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
    }

    .mode-choice[data-mode='1'] {
      --hero-gem: var(--gem-translation);
    }

    .mode-choice[data-mode='2'] {
      --hero-gem: var(--gem-example);
    }

    .mode-choice[data-mode='3'] {
      --hero-gem: var(--gem-definition);
    }

    .mode-choice {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      width: 100%;
      min-width: 0;
      border: 1px solid color-mix(in srgb, var(--hero-gem) 48%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--hero-gem) 12%, transparent);
      color: var(--text);
      padding: 0.75rem 0.35rem 0.65rem;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 650;
      text-align: center;
      cursor: pointer;
    }

    .mode-choice:hover {
      background: color-mix(in srgb, var(--hero-gem) 18%, transparent);
    }

    .mode-choice.selected {
      border-color: color-mix(in srgb, var(--hero-gem) 72%, transparent);
      background: color-mix(in srgb, var(--hero-gem) 22%, transparent);
      color: var(--text);
    }

    .mode-choice app-mode-icon {
      width: 2.55rem;
      height: 2.55rem;
      flex: none;
    }

    .comfort-choices {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.45rem;
    }

    .comfort-choice {
      display: grid;
      place-items: center;
      width: 100%;
      min-width: 0;
      height: 2.45rem;
      margin: 0;
      padding: 0;
      border: 1px solid var(--rate-color, var(--border));
      border-radius: 0.75rem;
      background: transparent;
      color: var(--rate-color, var(--text));
      font: inherit;
      font-size: 0.9rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }

    .comfort-choice:hover {
      background: color-mix(in srgb, var(--rate-color, var(--text)) 18%, transparent);
    }

    .comfort-choice.selected {
      background: var(--rate-color, var(--text));
      color: var(--bg);
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
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text);
      padding: 0.35rem 0.7rem;
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .meta-value:hover {
      background: rgba(127, 127, 127, 0.1);
    }

    .meta-value.selected {
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.45);
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
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-size: 0.88rem;
      font-weight: 700;
      padding: 0.65rem 1.25rem;
      cursor: pointer;
    }

    .done-btn:hover {
      filter: brightness(1.06);
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
  private comfortApplied = false;
  private scrollLock = '';
  private scrollLocked = false;
  private promptedLanguage = false;

  readonly languageOptions = LEARNABLE_LANGUAGES;
  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly modeLabel = elementModeLabel;
  readonly comfortRates = COMFORT_RATES;
  readonly comfortColor = comfortColor;
  readonly asking = signal(false);
  readonly translationInto = translationInto;
  readonly discoverOpen = signal(false);
  readonly lookupError = signal('');
  readonly selecting = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectionBusy = signal(false);
  readonly selectionError = signal('');
  readonly comfortOpen = signal(false);
  readonly comfortDraft = signal(1);
  readonly deleteConfirm = signal(false);
  readonly skeletons = ELEMENT_SKELETONS;
  private readonly baseSortOptions: { value: ElementSort; label: string }[] = [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'created-desc', label: 'Most recent' },
    { value: 'created-asc', label: 'Least recent' },
    { value: 'definitions-desc', label: 'Most definitions' },
    { value: 'translations-desc', label: 'Most translations' },
    { value: 'clicks-desc', label: 'Most seen' },
    { value: 'clicks-asc', label: 'Least seen' },
  ];
  readonly sortOptions = computed(() => {
    if (!this.modeFilter().length) return this.baseSortOptions;
    return [
      ...this.baseSortOptions,
      { value: 'gems-desc' as const, label: 'Most gems' },
      { value: 'gems-asc' as const, label: 'Least gems' },
    ];
  });
  readonly code = signal('');
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly sort = signal<ElementSort>(DEFAULT_ELEMENT_SORT);
  readonly modes: readonly ElementMode[] = [1, 2, 3];
  readonly contentSections: readonly ContentSection[] = [
    {
      id: 'definitions',
      kind: 'definitions',
      title: 'Definitions',
      count: 'definitions',
      empty: 'No definition metadata yet. Recompute to collect it.',
    },
    {
      id: 'examples',
      kind: 'examples',
      title: 'Examples',
      count: null,
      empty: 'No example metadata yet. Recompute to collect it.',
    },
    {
      id: 'forms',
      kind: 'forms',
      title: 'Forms',
      count: null,
      empty: 'No form metadata yet. Recompute to collect it.',
    },
  ];
  readonly translationRange = signal<ElementCountRange>({ min: 0, max: null });
  readonly definitionRange = signal<ElementCountRange>({ min: 0, max: null });
  readonly modeFilter = signal<ElementMode[]>([]);
  readonly comfortFilter = signal<number[]>([]);
  readonly definitionMetaFilter = signal<ElementMetadataVariability>({});
  readonly exampleMetaFilter = signal<ElementMetadataVariability>({});
  readonly formMetaFilter = signal<ElementMetadataVariability>({});
  readonly metadataCatalog = signal<ElementMetadataIndexes>(emptyMetadataIndexes());
  readonly recomputing = signal(false);
  readonly recomputeError = signal('');
  readonly sortOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly statsOpen = signal(false);
  readonly playing = signal(false);
  readonly playId = signal('');
  readonly playOrder = signal<readonly string[]>([]);
  readonly dismissed = signal<ReadonlySet<string>>(new Set());
  readonly expanded = signal<FilterSection | null>('translations');
  readonly elementId = signal('');
  readonly trail = signal<string[]>([]);
  readonly canGoBack = computed(() => this.trail().length > 1);
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly optionalFilterCount = computed(
    () =>
      this.modeFilter().length +
      this.comfortFilter().length +
      (this.rangeActive(this.translationRange()) ? 1 : 0) +
      (this.rangeActive(this.definitionRange()) ? 1 : 0) +
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
    const translations = this.translationRange();
    const definitions = this.definitionRange();
    const mode = this.modeFilter();
    const comfort = this.comfortFilter();
    const definitionMeta = this.definitionMetaFilter();
    const exampleMeta = this.exampleMetaFilter();
    const formMeta = this.formMetaFilter();
    const matched = this.elements().filter((element) => {
      if (search.mode === 'prefix' && !elementMatchesPrefix(element, search.value)) return false;
      if (!elementMatchesMode(element, mode)) return false;
      if (!elementMatchesComfort(element, comfort)) return false;
      if (!elementMatchesCountRanges(element, translations, definitions)) return false;
      return elementMatchesMetadata(element, definitionMeta, exampleMeta, formMeta);
    });
    return matched.slice().sort((left, right) => compareElements(left, right, this.sort()));
  });
  readonly playable = computed(() => this.visible().filter((element) => element.mode !== null));
  readonly shown = computed(() => {
    const visible = this.visible();
    if (!this.playing()) return visible;
    const dismissed = this.dismissed();
    const rank = new Map(this.playOrder().map((id, index) => [id, index]));
    return this.playable()
      .filter((element) => !dismissed.has(element.id))
      .slice()
      .sort((left, right) => {
        const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
  });
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
    if (this.playing() && this.playable().length > 0) return 'Nothing left this round.';
    if (this.playing() && this.visible().length > 0) return 'No elements ready for games.';
    return 'No matching elements.';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.clearPressTimer();
      if (this.overlayOpen()) this.unlockScroll(true);
    });
    void this.loadCatalog();
    void this.load(ensureSelectedLanguage() ?? '');
    effect(() => {
      if (!this.playing()) return;
      const dismissed = this.dismissed();
      const order = this.playOrder();
      const known = new Set([...order, ...dismissed]);
      const newcomers = this.playable()
        .map((element) => element.id)
        .filter((id) => !known.has(id));
      if (newcomers.length === 0) return;
      this.playOrder.set([...order, ...shuffleIds(newcomers)]);
    });
  }

  @HostListener('document:click', ['$event'])
  closeSortFromDocument(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.toolbar-menu')) this.sortOpen.set(false);
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
    if (this.filtersOpen()) {
      this.closeFilters();
      return;
    }
    if (this.elementId() || this.selectionBusy()) return;
    if (this.comfortOpen()) {
      this.closeComfortSheet();
      return;
    }
    if (this.deleteConfirm()) {
      this.deleteConfirm.set(false);
      return;
    }
    if (this.selecting()) {
      this.clearSelection();
      return;
    }
    this.sortOpen.set(false);
  }

  openElement(id: string): void {
    if (!id) return;
    this.trail.set([id]);
    this.showElement(id);
  }

  openCard(id: string): void {
    if (this.playing()) {
      this.playCard(id);
      return;
    }
    this.recordClick(id);
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
    if (this.playing()) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.selecting()) {
      if (!this.selectedIds().has(id)) this.toggleSelected(id);
      return;
    }
    this.beginSelection(id);
  }

  onCardPointerDown(event: PointerEvent, id: string): void {
    if (this.playing() || this.selecting() || this.selectionBusy()) return;
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
    this.comfortOpen.set(false);
    this.deleteConfirm.set(false);
    this.comfortApplied = false;
    this.selectionError.set('');
  }

  openSelectionComfort(): void {
    if (this.selectionBusy() || this.selectedIds().size === 0) return;
    const selected = this.selectedElements();
    const shared = selected[0]?.comfort ?? 1;
    const rate = selected.every((element) => element.comfort === shared) ? shared : 1;
    this.comfortDraft.set(rate);
    this.comfortApplied = false;
    this.deleteConfirm.set(false);
    this.comfortOpen.set(true);
  }

  closeComfortSheet(event?: Event): void {
    event?.stopPropagation();
    if (this.selectionBusy()) return;
    this.comfortOpen.set(false);
    if (!this.comfortApplied) return;
    this.comfortApplied = false;
    this.clearSelection();
  }

  async stepSelectionComfort(delta: number): Promise<void> {
    const rate = Math.min(10, Math.max(1, this.comfortDraft() + delta));
    if (rate === this.comfortDraft() || this.selectionBusy()) return;
    const saved = await this.writeSelected((element) =>
      element.comfort === rate
        ? element
        : {
            ...element,
            comfort: rate,
            log: [...element.log, { event: 'comfort', comfort: rate, at: Date.now() }],
          },
    );
    if (!saved) return;
    this.comfortDraft.set(rate);
    this.comfortApplied = true;
  }

  askDeleteSelection(): void {
    if (this.selectionBusy() || this.selectedIds().size === 0) return;
    this.comfortOpen.set(false);
    this.deleteConfirm.set(true);
  }

  closeDeleteConfirm(event?: Event): void {
    event?.stopPropagation();
    if (this.selectionBusy()) return;
    this.deleteConfirm.set(false);
  }

  deleteSelectionTitle(): string {
    return this.selectedIds().size === 1
      ? 'Delete this element?'
      : `Delete ${this.selectedIds().size} elements?`;
  }

  async confirmDeleteSelection(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length || this.selectionBusy()) return;
    this.selectionBusy.set(true);
    this.selectionError.set('');
    try {
      await Promise.all(ids.map((id) => deleteElement(id)));
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
    if (this.playing() || this.selectionBusy() || !id) return;
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
    if (this.comfortOpen() || this.deleteConfirm()) return;
    if (
      target?.closest('.element, .list-toolbar-actions, .selection-backdrop, app-element-modal')
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
      return true;
    } catch {
      this.selectionError.set('Could not update these elements.');
      return false;
    } finally {
      this.selectionBusy.set(false);
    }
  }

  private recordClick(id: string): void {
    const current = this.elements().find((element) => element.id === id);
    if (!current) return;
    const opened: ElementLogEntry = { event: 'click', at: Date.now() };
    const next: StoredElement = {
      ...current,
      clicks: current.clicks + 1,
      log: [...current.log, opened],
    };
    this.elements.update((list) => list.map((item) => (item.id === id ? next : item)));
    void saveElement(next).then((saved) => {
      if (this.elements().some((item) => item.id === saved.id)) this.replaceElement(saved);
    });
  }

  visitElement(id: string): void {
    if (!id || id === this.elementId()) return;
    this.trail.update((trail) => [...trail, id]);
    this.showElement(id);
  }

  backElement(): void {
    const trail = this.trail();
    if (trail.length < 2) return;
    const next = trail.slice(0, -1);
    this.trail.set(next);
    this.showElement(next[next.length - 1] ?? '');
  }

  async addFromSelection(pick: { title: string; language: string }): Promise<void> {
    const name = pick.title.replace(/\s+/g, ' ').trim();
    const code = pick.language.trim().toLowerCase();
    if (!name || !code) return;
    const created = await addElement(code, name);
    if (code === this.code()) this.elements.set(await readElements(code));
    if (created.id === this.elementId()) return;
    this.visitElement(created.id);
  }

  async addPrepared(
    prepared: {
      title: string;
      language?: string;
      definitions: ElementDefinition[];
      example?: string;
    },
    fromSearch = false,
  ): Promise<void> {
    const name = prepared.title.replace(/\s+/g, ' ').trim();
    const code = (prepared.language || this.code()).trim().toLowerCase();
    if (!name || !code) return;
    const example = prepared.example?.replace(/\s+/g, ' ').trim() ?? '';
    let created = await addElement(code, name);
    if (!created.definitions.length && prepared.definitions.length) {
      created = await saveElement({ ...created, definitions: prepared.definitions });
    } else if (example && created.definitions.length && !hasExample(created, example)) {
      const definitions = created.definitions.map((definition, index) =>
        index === 0
          ? {
              ...definition,
              examples: [{ text: example, metadata: {} }, ...definition.examples],
            }
          : definition,
      );
      created = await saveElement({ ...created, definitions });
    }
    if (this.code() === code) this.elements.set(await readElements(code));
    if (this.code() === code) {
      this.metadataCatalog.update((current) => mergeMetadataIndexes(current, created));
    }
    if (fromSearch) {
      this.clearSearch();
      this.trail.set([created.id]);
      this.showElement(created.id);
      return;
    }
    if (created.id === this.elementId()) return;
    this.visitElement(created.id);
  }

  replaceElement(saved: StoredElement): void {
    this.elements.update((list) => list.map((item) => (item.id === saved.id ? saved : item)));
    this.metadataCatalog.update((current) => mergeMetadataIndexes(current, saved));
  }

  onElementDeleted(): void {
    const id = this.elementId();
    if (id) {
      this.elements.update((list) => list.filter((item) => item.id !== id));
      this.dropSelected(id);
    }
    this.closeElement();
  }

  closeElement(): void {
    if (!this.elementId()) return;
    this.playId.set('');
    this.trail.set([]);
    this.showElement(null);
  }

  private showElement(id: string | null): void {
    this.elementId.set(id ?? '');
    if (!id) this.trail.set([]);
  }

  highlight(text: string): ElementSearchPart[] {
    return elementHighlightParts(displayTitle(text, this.code()), this.search());
  }

  definitionsLabel(count: number): string {
    return count === 1 ? '1 definition' : `${count} definitions`;
  }

  clicksLabel(count: number): string {
    return count === 1 ? '1 click' : `${count} clicks`;
  }

  gemTotals(
    element: StoredElement,
  ): { game: 'translation' | 'example' | 'definition'; gems: number }[] {
    let translation = 0;
    let example = 0;
    let definition = 0;
    for (const item of element.definitions) {
      for (const entry of item.log) {
        if (entry.event !== 'game') continue;
        if (entry.game === 'translation') translation += entry.gems;
        else if (entry.game === 'example') example += entry.gems;
        else definition += entry.gems;
      }
    }
    const totals: { game: 'translation' | 'example' | 'definition'; gems: number }[] = [
      { game: 'translation', gems: translation },
      { game: 'example', gems: example },
      { game: 'definition', gems: definition },
    ];
    return totals;
  }

  modeGem(
    element: StoredElement,
  ): { game: 'translation' | 'example' | 'definition'; gems: number } | null {
    const mode = element.mode;
    const game =
      mode === 1 ? 'translation' : mode === 2 ? 'example' : mode === 3 ? 'definition' : null;
    if (!game) return null;
    return this.gemTotals(element).find((total) => total.game === game) ?? null;
  }

  gemsLabel(game: 'translation' | 'example' | 'definition', count: number): string {
    const amount = count === 1 ? '1 gem' : `${count} gems`;
    return `${amount} from ${game}`;
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onSearch(value: string): void {
    if (this.playing()) return;
    const query = value.slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    this.query.set(query);
    this.lookupError.set('');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.commitSearch(), 250);
  }

  async lookup(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.query().trim();
    const code = this.code();
    if (!title || !code || this.asking() || this.playing()) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const created = await addElement(code, title);
    this.elements.set(await readElements(code));
    this.clearSearch();
    this.trail.set([created.id]);
    this.showElement(created.id);
  }

  async askFromSearch(): Promise<void> {
    const selected = this.query().trim();
    const code = this.code();
    if (!selected || !code || this.asking() || this.playing()) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.asking.set(true);
    this.lookupError.set('');
    try {
      const generated = await generateElementFromSelection({
        language: code,
        selected,
        context: '',
        translation: this.translationTarget(),
      });
      if (!generated) {
        this.lookupError.set('Could not add that element.');
        return;
      }
      await this.addPrepared(
        {
          title: generated.lemma,
          definitions: generated.definitions.map((sense) => ({
            text: sense.text,
            equivalentId: null,
            forms: searchForms(generated.lemma, selected),
            examples: [],
            metadata: { ...sense.metadata },
            log: [],
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

  private clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.query.set('');
    this.search.set(elementPrefixSearch(''));
  }

  playCard(id: string, event?: Event): void {
    event?.stopPropagation();
    if (!this.playing() || !id) return;
    this.dismissCard(id);
    const element = this.elements().find((item) => item.id === id);
    const playable = !!element && element.mode !== null && element.definitions.length > 0;
    this.playId.set(playable ? id : '');
    this.openElement(id);
  }

  dismissCard(id: string): void {
    if (!this.playing() || !id || this.dismissed().has(id)) return;
    const dismissed = new Set(this.dismissed());
    dismissed.add(id);
    this.dismissed.set(dismissed);
    this.playOrder.set(shuffleIds(this.playOrder().filter((item) => item !== id)));
  }

  togglePlay(): void {
    if (!this.code()) return;
    if (this.playing()) {
      this.playing.set(false);
      this.playOrder.set([]);
      this.dismissed.set(new Set());
      this.playId.set('');
      return;
    }
    this.commitSearch();
    this.clearSelection();
    this.sortOpen.set(false);
    if (this.discoverOpen()) this.closeDiscover();
    this.dismissed.set(new Set());
    this.playOrder.set(shuffleIds(this.playable().map((element) => element.id)));
    this.playing.set(true);
  }

  toggleSort(event: Event): void {
    event.stopPropagation();
    if (this.playing() || !this.code()) return;
    this.sortOpen.update((open) => !open);
  }

  chooseSort(sort: ElementSort): void {
    if (this.playing() || !this.code()) return;
    this.sortOpen.set(false);
    this.sort.set(this.sort() === sort ? 'none' : sort);
  }

  openDiscover(event: Event): void {
    event.stopPropagation();
    if (this.playing() || !this.code()) return;
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
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
    this.metadataCatalog.set(catalog);
  }

  openFilters(event: Event): void {
    event.stopPropagation();
    this.sortOpen.set(false);
    if (this.discoverOpen()) this.closeDiscover();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) this.closeStats();
    this.expanded.set(this.code() ? 'translations' : 'language');
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

  rangeActive(range: ElementCountRange): boolean {
    return range.min > 0 || range.max != null;
  }

  rangeSummary(range: ElementCountRange): string {
    const { min, max } = range;
    if (max == null) return min > 0 ? `${min}+` : '';
    return min === max ? `${min}` : `${min}–${max}`;
  }

  boundValue(value: number | null): string {
    return value == null ? '' : String(value);
  }

  canStep(kind: 'translations' | 'definitions', edge: 'min' | 'max', by: number): boolean {
    const range = this.rangeFor(kind);
    const next = stepCountRange(range, edge, by);
    return next.min !== range.min || next.max !== range.max;
  }

  stepBound(kind: 'translations' | 'definitions', edge: 'min' | 'max', by: number): void {
    this.setRange(kind, stepCountRange(this.rangeFor(kind), edge, by));
  }

  commitBound(kind: 'translations' | 'definitions', edge: 'min' | 'max', event: Event): void {
    const input = event.target as HTMLInputElement;
    const parsed = readBound(input.value);
    const range = this.rangeFor(kind);
    if (!parsed.ok) {
      input.value = this.boundValue(edge === 'min' ? range.min : range.max);
      return;
    }
    const value = edge === 'min' && parsed.value == null ? 0 : parsed.value;
    this.setRange(kind, setCountRangeBound(range, edge, value));
  }

  clearRange(kind: 'translations' | 'definitions'): void {
    this.setRange(kind, { min: 0, max: null });
  }

  modeSelected(mode: ElementMode): boolean {
    return this.modeFilter().includes(mode);
  }

  modeSummary(): string {
    const modes = this.modeFilter();
    return modes.length === 1 ? this.modeLabel(modes[0]) : String(modes.length);
  }

  chooseMode(mode: ElementMode): void {
    const current = this.modeFilter();
    const next = current.includes(mode)
      ? current.filter((item) => item !== mode)
      : [...current, mode].sort((left, right) => left - right);
    this.modeFilter.set(next);
    if (!next.length) this.releaseGemSort();
  }

  clearMode(): void {
    this.modeFilter.set([]);
    this.releaseGemSort();
  }

  comfortSelected(rate: number): boolean {
    return this.comfortFilter().includes(rate);
  }

  comfortSummary(): string {
    const rates = this.comfortFilter();
    return rates.length === 1 ? String(rates[0]) : String(rates.length);
  }

  chooseComfort(rate: number): void {
    const current = this.comfortFilter();
    const next = current.includes(rate)
      ? current.filter((item) => item !== rate)
      : [...current, rate].sort((left, right) => left - right);
    this.comfortFilter.set(next);
  }

  clearComfort(): void {
    this.comfortFilter.set([]);
  }

  clearFilters(): void {
    this.modeFilter.set([]);
    this.comfortFilter.set([]);
    this.translationRange.set({ min: 0, max: null });
    this.definitionRange.set({ min: 0, max: null });
    this.definitionMetaFilter.set({});
    this.exampleMetaFilter.set({});
    this.formMetaFilter.set({});
    this.releaseGemSort();
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
    return (
      this.metadataValueCount(section.kind) > 0 ||
      (section.count === 'definitions' && this.rangeActive(this.definitionRange()))
    );
  }

  clearSection(section: ContentSection): void {
    if (section.count === 'definitions') this.definitionRange.set({ min: 0, max: null });
    this.setMetadataFilter(section.kind, {});
  }

  languageName(code: string): string {
    return languageDisplayName(code);
  }

  askLabel(): string {
    const into = this.translationTarget();
    if (!into) return 'Ask AI';
    return `Ask AI with a ${this.languageName(into)} translation`;
  }

  private translationTarget(): string {
    const learning = this.code().trim().toLowerCase();
    const into = this.translationInto().trim().toLowerCase();
    if (!isLearnableLanguage(into) || into === learning) return '';
    return into;
  }

  chooseLanguageValue(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isLearnableLanguage(value) || value === this.code()) return;
    writeSelectedLanguage(value);
    void this.load(value);
  }

  openSettings(): void {
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
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
  }

  openStats(): void {
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
    if (this.discoverOpen()) this.closeDiscover();
    if (this.settingsOpen()) this.closeSettings();
    if (this.statsOpen()) return;
    this.statsOpen.set(true);
    this.lockScroll();
  }

  closeStats(): void {
    if (!this.statsOpen()) return;
    this.statsOpen.set(false);
    this.unlockScroll();
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
      const union = next.reduce(
        (indexes, element) => mergeMetadataIndexes(indexes, element),
        emptyMetadataIndexes(),
      );
      const catalog = await replaceMetadataCatalog(union);
      const code = this.code();
      if (code) this.elements.set(next.filter((element) => element.language === code));
      this.metadataCatalog.set(catalog);
    } catch {
      this.recomputeError.set('Could not recompute metadata.');
    } finally {
      this.recomputing.set(false);
    }
  }

  private async loadCatalog(): Promise<void> {
    this.metadataCatalog.set(await readMetadataCatalog());
  }

  private async load(language: string): Promise<void> {
    const seq = ++this.loadId;
    const code = language.trim().toLowerCase();
    this.playing.set(false);
    this.playOrder.set([]);
    this.dismissed.set(new Set());
    this.playId.set('');
    this.clearSelection();
    this.sortOpen.set(false);
    if (this.discoverOpen()) this.closeDiscover();
    this.elementId.set('');
    this.trail.set([]);
    if (!isLearnableLanguage(code)) {
      this.code.set('');
      this.name.set('');
      this.elements.set([]);
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
    this.ready.set(false);
    const elements = await readElements(code);
    if (seq !== this.loadId) return;
    this.elements.set(elements);
    this.ready.set(true);
  }

  private releaseGemSort(): void {
    const sort = this.sort();
    if (this.modeFilter().length === 0 && (sort === 'gems-desc' || sort === 'gems-asc')) {
      this.sort.set(DEFAULT_ELEMENT_SORT);
    }
  }

  private overlayOpen(): boolean {
    return this.filtersOpen() || this.settingsOpen() || this.statsOpen() || this.discoverOpen();
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

  private rangeFor(kind: 'translations' | 'definitions'): ElementCountRange {
    return kind === 'translations' ? this.translationRange() : this.definitionRange();
  }

  private setRange(kind: 'translations' | 'definitions', range: ElementCountRange): void {
    if (kind === 'translations') this.translationRange.set(range);
    else this.definitionRange.set(range);
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

function shuffleIds(ids: readonly string[]): string[] {
  const next = ids.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = next[index] ?? '';
    next[index] = next[swap] ?? '';
    next[swap] = current;
  }
  return next;
}

function readBound(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim();
  if (!text || text.toLowerCase() === 'any') return { ok: true, value: null };
  if (!/^\d{1,2}$/.test(text)) return { ok: false };
  const value = Number(text);
  if (value > 99) return { ok: false };
  return { ok: true, value };
}

function hasExample(element: StoredElement, example: string): boolean {
  const key = example.trim().toLowerCase();
  return element.definitions.some((definition) =>
    definition.examples.some((item) => item.text.trim().toLowerCase() === key),
  );
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
