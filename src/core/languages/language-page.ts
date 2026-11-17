import {
  CdkDrag,
  CdkDragPreview,
  CdkDropList,
  moveItemInArray,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ElementModal } from '../elements/element-modal';
import { GemStatsModal } from '../elements/gem-stats-modal';
import { HighlightColorPicker } from '../elements/highlight-color-picker';
import { ModeIcon } from '../elements/mode-icon';
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
  displayTitle,
  equivalentTextFor,
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesColor,
  elementMatchesMetadata,
  elementMatchesPrefix,
  elementModeHelp,
  elementModeLabel,
  parsePassage,
  elementPrefixSearch,
  emptyElementCatalog,
  sanitizeElementColor,
  formatMetadataFilter,
  isLearnableLanguage,
  isValidForm,
  LEARNABLE_LANGUAGES,
  languageDisplayName,
  loggedDefinitions,
  mergeMetadataVariability,
  metadataFilterSize,
  parseMetadataFilter,
  readAllElements,
  readElements,
  readMetadataCatalog,
  replaceElementColorOrder,
  saveElement,
  syncElementColorCatalog,
  type ElementCatalog,
  type ElementDefinition,
  type ElementMetadataVariability,
  type ElementMode,
  type ElementSearch,
  type ElementSearchPart,
  type ElementSort,
  type StoredElement,
} from 'collection';

type FilterSection = 'language' | 'color' | 'definitions' | 'examples' | 'forms';

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
  imports: [
    FormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragPreview,
    ElementModal,
    ModeIcon,
    DiscoverModal,
    Settings,
    GemStatsModal,
    HighlightColorPicker,
  ],
  template: `
    <main>
      <div class="page-top">
        <section class="entries-toolbar" aria-label="Search">
          <form class="search-bar" autocomplete="off" (submit)="lookup($event)">
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
                  type="button"
                  class="search-add"
                  aria-label="Ask AI"
                  title="Ask AI"
                  [disabled]="asking()"
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
                  [disabled]="asking()"
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
                [disabled]="!code()"
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
              @if (sortOpen()) {
                <div
                  class="toolbar-popover"
                  role="listbox"
                  aria-label="Sort collection"
                  (click)="$event.stopPropagation()"
                >
                  @for (option of sortOptions; track option.value) {
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
              <span class="count-badge">{{ countLabel() }}</span>
            </p>
            @if (selecting()) {
              <div class="list-toolbar-actions">
                @if (selectedIds().size) {
                  <button
                    type="button"
                    class="list-action"
                    [class.active]="colorOpen()"
                    aria-label="Set color"
                    title="Set color"
                    [disabled]="selectionBusy()"
                    (click)="openSelectionColor()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m9 11-6 6v3h9l3-3" />
                      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
                      <path d="M3 22h18" />
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
              <li class="card skeleton">
                <div class="element">
                  <span class="bone bone-title"></span>
                  <span class="bone bone-pill"></span>
                </div>
                <span class="bone bone-drill"></span>
                <span class="bone bone-side"></span>
              </li>
            }
          </ul>
        } @else if (shown().length) {
          <ul class="elements">
            @for (element of shown(); track element.id) {
              <li
                class="card"
                [class.selected]="isSelected(element.id)"
                [class.colored]="!!cardAccent(element)"
                [style.--score-color]="cardAccent(element)"
                (click)="onCardClick(element.id, $event)"
                (contextmenu)="onCardContextMenu($event, element.id)"
                (pointerdown)="onCardPointerDown($event, element.id)"
                (pointermove)="onCardPointerMove($event)"
                (pointerup)="onCardPointerUp()"
                (pointercancel)="onCardPointerUp()"
                (pointerleave)="onCardPointerUp()"
              >
                @let activity = activityTotals(element);
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
                @if (element.definitions.length) {
                  <button
                    type="button"
                    class="drill"
                    aria-label="Drill"
                    title="Drill"
                    [disabled]="selecting()"
                    (click)="askDrill(element.id)"
                  >
                    <span class="drill-label">Drill</span>
                    <svg class="drill-arrow" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                }
                <div class="stat-rail">
                  @for (total of earnedGems(element); track total.game) {
                    <span
                      class="earned-gems"
                      [attr.data-game]="total.game"
                      [attr.aria-label]="gemsLabel(total.game, total.gems)"
                      [attr.title]="gemsLabel(total.game, total.gems)"
                    >
                      <app-mode-icon [mode]="gameMode(total.game)" />
                      <span>{{ total.gems }}</span>
                    </span>
                  }
                  <span
                    class="stat stat-opened"
                    [class.zero]="activity.opened === 0"
                    [attr.aria-label]="openedLabel(activity.opened)"
                    [attr.title]="openedLabel(activity.opened)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
                      />
                    </svg>
                    <span>{{ activity.opened }}</span>
                  </span>
                  <span
                    class="stat stat-reworked"
                    [class.zero]="activity.reworked === 0"
                    [attr.aria-label]="reworkedLabel(activity.reworked)"
                    [attr.title]="reworkedLabel(activity.reworked)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
                      <path d="m18 15 4-4" />
                      <path
                        d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"
                      />
                    </svg>
                    <span>{{ activity.reworked }}</span>
                  </span>
                  <span
                    class="stat stat-exercised"
                    [class.zero]="activity.exercises === 0"
                    [attr.aria-label]="exercisedLabel(activity.exercises)"
                    [attr.title]="exercisedLabel(activity.exercises)"
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
                    <span>{{ activity.exercises }}</span>
                  </span>
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
                  Keep elements by language, color, counts, or metadata.
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

              <section class="filter-section" [class.expanded]="expanded() === 'color'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'color'"
                  (click)="toggleSection('color')"
                >
                  <span class="section-title">
                    Color
                    @if (colorFilter().length) {
                      <span class="section-count">{{ colorSummary() }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'color') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="colorFilter().length === 0"
                        (click)="clearColor()"
                      >
                        Clear
                      </button>
                    </div>
                    @if (!colorOptions().length) {
                      <p class="section-hint">Colors show up once an element has one.</p>
                    } @else if (orderingColors) {
                      <p class="section-hint">
                        Drag to reorder. The first color is what new elements get.
                      </p>
                      <div
                        class="color-choices"
                        cdkDropList
                        cdkDropListOrientation="mixed"
                        role="group"
                        aria-label="Color"
                        (cdkDropListDropped)="reorderColors($event)"
                      >
                        @for (color of colorOptions(); track color; let first = $first) {
                          <div class="color-choice" cdkDrag>
                            <button
                              type="button"
                              class="color-swatch draggable"
                              [class.selected]="colorSelected(color)"
                              [attr.aria-pressed]="colorSelected(color)"
                              [attr.aria-label]="first ? color + ', default' : color"
                              [style.--swatch]="color"
                              (click)="chooseColor(color)"
                            ></button>
                            @if (first) {
                              <span class="color-default">Default</span>
                            }
                            <ng-template cdkDragPreview>
                              <span
                                class="color-swatch-preview"
                                [style.background]="color"
                                [style.width.rem]="2.2"
                                [style.height.rem]="2.2"
                              ></span>
                            </ng-template>
                          </div>
                        }
                      </div>
                    } @else {
                      <p class="section-hint">Show elements in any selected color.</p>
                      <div class="color-choices" role="group" aria-label="Color">
                        @for (color of colorOptions(); track color; let first = $first) {
                          <div class="color-choice">
                            <button
                              type="button"
                              class="color-swatch"
                              [class.selected]="colorSelected(color)"
                              [attr.aria-pressed]="colorSelected(color)"
                              [attr.aria-label]="first ? color + ', default' : color"
                              [style.--swatch]="color"
                              (click)="chooseColor(color)"
                            ></button>
                            @if (first) {
                              <span class="color-default">Default</span>
                            }
                          </div>
                        }
                      </div>
                    }
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

      @if (colorOpen()) {
        <div class="selection-backdrop" (click)="closeColorSheet($event)">
          <div class="highlight-picker-stack">
            <app-highlight-color-picker
              [color]="selectionColor()"
              [colors]="colorOptions()"
              [disabled]="selectionBusy()"
              (saved)="confirmSelectionColor($event)"
              (dismissed)="closeColorSheet()"
            />
            @if (selectionError()) {
              <p class="selection-error">{{ selectionError() }}</p>
            }
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

      @if (drillTarget(); as element) {
        <div class="selection-backdrop" (click)="closeDrill($event)">
          <section
            class="selection-sheet drill-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Drill"
            (click)="$event.stopPropagation()"
          >
            <div class="selection-head">
              <h3>Drill</h3>
              <button type="button" class="icon-btn" aria-label="Close" (click)="closeDrill()">
                <svg viewBox="0 0 24 24">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div class="drill-choices">
              @for (mode of modes(); track mode) {
                <button
                  type="button"
                  class="drill-choice"
                  [attr.data-mode]="mode"
                  [disabled]="!drillReady(element, mode)"
                  (click)="startDrill(mode)"
                >
                  <app-mode-icon [mode]="mode" />
                  <span class="drill-copy">
                    <strong>{{ modeLabel(mode) }}</strong>
                    <span>{{ modeHelp(mode) }}</span>
                  </span>
                </button>
              }
            </div>
          </section>
        </div>
      }

      @if (settingsOpen()) {
        <app-settings (closed)="closeSettings()" (changed)="onCollectionReplaced()" />
      }

      @if (statsOpen()) {
        <app-gem-stats [language]="code()" (closed)="closeStats()" />
      }

      @if (opened(); as element) {
        <app-element-modal
          [element]="element"
          [collection]="elements()"
          [colors]="colorOptions()"
          [canGoBack]="canGoBack()"
          [playing]="element.id === playId()"
          [playMode]="element.id === playId() ? playMode() : null"
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
      padding: calc(1.25rem + env(safe-area-inset-top, 0px)) 1.25rem 0.35rem;
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
      width: 1.25rem;
      height: 1.25rem;
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

    .toolbar-menu {
      position: relative;
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
      padding: 0.12rem 0.45rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 0.4rem;
      background: rgba(255, 255, 255, 0.05);
      color: #94a3b8;
      font-size: 0.62rem;
      font-weight: 650;
      letter-spacing: 0.06em;
      text-transform: uppercase;
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
      backdrop-filter: blur(6px);
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

    .drill-sheet {
      width: min(26rem, 100%);
    }

    .drill-choices {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .drill-choice[data-mode='1'] {
      --hero-gem: var(--gem-translation);
    }

    .drill-choice[data-mode='2'] {
      --hero-gem: var(--gem-example);
    }

    .drill-choice[data-mode='3'] {
      --hero-gem: var(--gem-definition);
    }

    .drill-choice {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      width: 100%;
      margin: 0;
      padding: 0.75rem 0.85rem;
      border: 1px solid color-mix(in srgb, var(--hero-gem) 48%, transparent);
      border-radius: 1rem;
      background: color-mix(in srgb, var(--hero-gem) 12%, transparent);
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .drill-choice:hover:not(:disabled) {
      background: color-mix(in srgb, var(--hero-gem) 18%, transparent);
    }

    .drill-choice:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .drill-choice app-mode-icon {
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
    }

    .drill-copy {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.22rem;
      min-width: 0;
    }

    .drill-copy strong {
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1.2;
    }

    .drill-copy span {
      color: var(--text-muted);
      font-size: 0.78rem;
      line-height: 1.4;
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
      gap: 0.35rem;
      margin-top: 0.7rem;
      padding: 0.55rem 0 0.7rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .stat {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      min-width: 0;
      color: #cbd5e1;
      font-size: 0.625rem;
      font-weight: 550;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .stat.zero {
      opacity: 0.4;
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

    .earned-gems {
      display: inline-flex;
      align-items: center;
      gap: 0.18rem;
      color: var(--exercise-gem);
      font-size: 0.78rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .earned-gems[data-game='translation'] {
      --exercise-gem: var(--gem-translation);
    }

    .earned-gems[data-game='example'] {
      --exercise-gem: var(--gem-example);
    }

    .earned-gems[data-game='definition'] {
      --exercise-gem: var(--gem-definition);
    }

    .earned-gems app-mode-icon {
      width: 1.05rem;
      height: 1.05rem;
    }

    .drill {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.28rem;
      width: 100%;
      margin-top: 0.7rem;
      padding: 0.38rem 0.5rem;
      border: 1px solid color-mix(in srgb, var(--card-accent, #94a3b8) 30%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--card-accent, #94a3b8) 15%, transparent);
      color: var(--card-accent, #cbd5e1);
      font: inherit;
      font-size: 0.75rem;
      font-weight: 650;
      line-height: 1;
      cursor: pointer;
    }

    .card:not(.colored) .drill {
      border-color: rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
    }

    .drill:hover:not(:disabled) {
      background: color-mix(in srgb, var(--card-accent, #94a3b8) 24%, transparent);
    }

    .drill:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .drill-arrow {
      display: block;
      flex: none;
      width: 0.75rem;
      height: 0.75rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .drill-label {
      color: inherit;
      font-size: inherit;
      font-weight: inherit;
      line-height: 1;
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

    .list-count .bone-count {
      display: inline-block;
      width: 5.5rem;
      height: 0.72em;
      vertical-align: -0.08em;
    }

    .skeleton .element {
      gap: 0.55rem;
    }

    .skeleton .bone-title {
      width: 62%;
      height: 1rem;
    }

    .skeleton .bone-pill {
      width: 42%;
      height: 0.5rem;
    }

    .skeleton .bone-drill {
      width: 100%;
      height: 1.7rem;
      margin-top: 0.7rem;
      border-radius: 0.75rem;
    }

    .skeleton .bone-side {
      width: 100%;
      height: 1.35rem;
      margin-top: 0.7rem;
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
      overflow: hidden;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
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
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
      border-bottom: 1px solid var(--border);
    }

    .filter-title {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
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

    .color-choices {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 0.55rem 0.7rem;
    }

    .color-choice {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.28rem;
      width: 3.4rem;
    }

    .color-default {
      color: var(--text-muted);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      line-height: 1;
      text-transform: uppercase;
    }

    .color-swatch {
      width: 2.2rem;
      height: 2.2rem;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 999px;
      background: var(--swatch);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.28);
      cursor: pointer;
    }

    .color-swatch:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    .color-swatch.selected {
      border-color: var(--text);
    }

    .color-swatch:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .color-swatch.draggable {
      cursor: grab;
      touch-action: none;
    }

    .color-swatch.draggable:active {
      cursor: grabbing;
    }

    .color-choices.cdk-drop-list-dragging .color-swatch:not(.cdk-drag-placeholder) {
      transition: transform 180ms ease;
    }

    .color-swatch-preview {
      display: block;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 999px;
      box-shadow:
        inset 0 0 0 1px rgba(0, 0, 0, 0.28),
        0 8px 18px rgba(0, 0, 0, 0.35);
    }

    .highlight-picker-stack {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      width: min(100%, 19.5rem);
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
  private colorApplied = false;
  private scrollLock = '';
  private scrollLocked = false;
  private promptedLanguage = false;

  readonly languageOptions = LEARNABLE_LANGUAGES;
  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly modeLabel = elementModeLabel;
  readonly modeHelp = elementModeHelp;
  readonly asking = signal(false);
  readonly discoverOpen = signal(false);
  readonly lookupError = signal('');
  readonly selecting = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectionBusy = signal(false);
  readonly selectionError = signal('');
  readonly colorOpen = signal(false);
  readonly deleteConfirm = signal(false);
  readonly skeletons = ELEMENT_SKELETONS;
  readonly sortOptions: { value: ElementSort; label: string }[] = [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'created-desc', label: 'Most recent' },
    { value: 'created-asc', label: 'Least recent' },
    { value: 'definitions-desc', label: 'Most definitions' },
    { value: 'translations-desc', label: 'Most translations' },
    { value: 'clicks-desc', label: 'Most seen' },
    { value: 'clicks-asc', label: 'Least seen' },
    { value: 'gems-desc', label: 'Most gems' },
    { value: 'gems-asc', label: 'Least gems' },
  ];
  readonly code = signal('');
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly leadFieldKey = signal(readDefinitionMetadataFields()[0]?.key ?? '');
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly sort = signal<ElementSort>(DEFAULT_ELEMENT_SORT);
  readonly modes = computed((): readonly ElementMode[] =>
    this.supportFor(this.code()) ? [1, 2, 3] : [2, 3],
  );
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
  readonly colorFilter = signal<string[]>([]);
  readonly definitionMetaFilter = signal<ElementMetadataVariability>({});
  readonly exampleMetaFilter = signal<ElementMetadataVariability>({});
  readonly formMetaFilter = signal<ElementMetadataVariability>({});
  readonly metadataCatalog = signal<ElementCatalog>(emptyElementCatalog());
  readonly orderingColors = isDevMode();
  readonly colorOptions = computed(() => this.metadataCatalog().colors);
  /** Drop time, so the click that ends a drag does not toggle the filter. */
  private colorDragAt = 0;
  readonly recomputing = signal(false);
  readonly recomputeError = signal('');
  readonly sortOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly statsOpen = signal(false);
  readonly playId = signal('');
  readonly playMode = signal<ElementMode | null>(null);
  readonly drillId = signal('');
  readonly expanded = signal<FilterSection | null>('definitions');
  readonly elementId = signal('');
  readonly trail = signal<string[]>([]);
  readonly canGoBack = computed(() => this.trail().length > 1);
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly drillTarget = computed(() => {
    const id = this.drillId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly optionalFilterCount = computed(
    () =>
      this.colorFilter().length +
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
    const color = this.colorFilter();
    const definitionMeta = this.definitionMetaFilter();
    const exampleMeta = this.exampleMetaFilter();
    const formMeta = this.formMetaFilter();
    const matched = this.elements().filter((element) => {
      if (search.mode === 'prefix' && !elementMatchesPrefix(element, search.value)) return false;
      if (!elementMatchesColor(element, color)) return false;
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
      if (this.playMode() !== 1 || this.supportFor(this.code())) return;
      this.playMode.set(null);
      this.playId.set('');
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
    if (this.drillId()) {
      this.drillId.set('');
      return;
    }
    if (this.colorOpen()) {
      this.closeColorSheet();
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
    if (this.playId() !== id) {
      this.playId.set('');
      this.playMode.set(null);
    }
    this.drillId.set('');
    this.trail.set([id]);
    this.showElement(id);
  }

  openCard(id: string): void {
    this.openElement(id);
  }

  askDrill(id: string): void {
    const element = this.elements().find((item) => item.id === id);
    if (!element || this.selecting() || element.definitions.length === 0) return;
    this.drillId.set(id);
  }

  startDrill(mode: ElementMode): void {
    const element = this.drillTarget();
    if (!element || !this.drillReady(element, mode)) return;
    if (mode === 1 && !this.supportFor(element.language)) return;
    this.playMode.set(mode);
    this.playId.set(element.id);
    this.openElement(element.id);
  }

  closeDrill(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.drillId.set('');
  }

  drillReady(element: StoredElement, mode: ElementMode): boolean {
    if (mode === 1) {
      const language = this.supportFor(element.language);
      if (!language) return false;
      return element.definitions.some(
        (definition) =>
          equivalentTextFor(element.equivalents, definition.equivalentIds, language).trim().length >
          0,
      );
    }
    if (mode === 2) {
      return element.definitions.some(
        (definition) => parsePassage(definition.text).text.trim().length > 0,
      );
    }
    return element.definitions.length > 0;
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  onCardClick(id: string, event?: Event): void {
    const target = event?.target instanceof Element ? event.target : null;
    if (target?.closest('.drill')) return;
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
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.drill')) return;
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
    this.colorOpen.set(false);
    this.deleteConfirm.set(false);
    this.colorApplied = false;
    this.selectionError.set('');
  }

  openSelectionColor(): void {
    if (this.selectionBusy() || this.selectedIds().size === 0) return;
    this.colorApplied = false;
    this.deleteConfirm.set(false);
    this.colorOpen.set(true);
  }

  closeColorSheet(event?: Event): void {
    event?.stopPropagation();
    if (this.selectionBusy()) return;
    this.colorOpen.set(false);
    if (!this.colorApplied) return;
    this.colorApplied = false;
    this.clearSelection();
  }

  selectionColor(): string | null {
    const selected = this.selectedElements();
    if (!selected.length) return null;
    const color = selected[0]?.color ?? null;
    return selected.every((element) => element.color === color) ? color : null;
  }

  async confirmSelectionColor(color: string | null): Promise<void> {
    await this.setSelectionColor(color);
    if (this.selectionError()) return;
    this.closeColorSheet();
  }

  async setSelectionColor(color: string | null): Promise<void> {
    const next = color == null ? null : sanitizeElementColor(color);
    if (color != null && !next) return;
    if (this.selectionBusy()) return;
    const saved = await this.writeSelected((element) =>
      element.color === next ? element : { ...element, color: next },
    );
    if (!saved) return;
    this.colorApplied = true;
  }

  askDeleteSelection(): void {
    if (this.selectionBusy() || this.selectedIds().size === 0) return;
    this.colorOpen.set(false);
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
    this.drillId.set('');
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
    if (this.colorOpen() || this.deleteConfirm()) return;
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
    this.applyCatalog(await readMetadataCatalog());
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
    this.playId.set('');
    this.playMode.set(null);
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

  leadPills(element: StoredElement): LeadValue[] {
    return compiledLeadValues(element, this.leadFieldKey());
  }

  cardAccent(element: StoredElement): string | null {
    return element.color ?? this.leadPills(element)[0]?.color ?? null;
  }

  /** Color of the metadata field shown under the title. The element color stays off this line. */
  leadColor(): string | null {
    return this.fieldColor('definitions', this.leadFieldKey());
  }

  pillLine(pills: LeadValue[]): string {
    return pills.map((pill) => pill.value).join(' · ');
  }

  /** Scores are not gems. Totals stay empty until gems are attributed. */
  gemTotals(
    _element: StoredElement,
  ): { game: 'translation' | 'example' | 'definition'; gems: number }[] {
    return [
      { game: 'translation', gems: 0 },
      { game: 'example', gems: 0 },
      { game: 'definition', gems: 0 },
    ];
  }

  earnedGems(
    element: StoredElement,
  ): { game: 'translation' | 'example' | 'definition'; gems: number }[] {
    return this.gemTotals(element).filter(
      (total) => total.gems > 0 && (total.game !== 'translation' || !!this.supportFor(this.code())),
    );
  }

  gameMode(game: 'translation' | 'example' | 'definition'): ElementMode {
    if (game === 'example') return 2;
    if (game === 'definition') return 3;
    return 1;
  }

  activityTotals(element: StoredElement): { opened: number; reworked: number; exercises: number } {
    let opened = 0;
    let reworked = 0;
    let exercises = 0;
    for (const item of loggedDefinitions(element)) {
      for (const entry of item.log) {
        if (entry.event === 'view') opened += 1;
        else if (entry.event === 'rework') reworked += 1;
        else if (
          entry.event === 'game' &&
          (entry.game === 'translation' || entry.game === 'example' || entry.game === 'definition')
        ) {
          exercises += 1;
        }
      }
    }
    return { opened, reworked, exercises };
  }

  gemsLabel(game: 'translation' | 'example' | 'definition', count: number): string {
    const amount = count === 1 ? '1 gem' : `${count} gems`;
    return `${amount} from ${game}`;
  }

  openedLabel(count: number): string {
    if (count === 0) return 'Not opened';
    return count === 1 ? 'Opened once' : `Opened ${count} times`;
  }

  reworkedLabel(count: number): string {
    if (count === 0) return 'Not reworked';
    return count === 1 ? 'Reworked once' : `Reworked ${count} times`;
  }

  exercisedLabel(count: number): string {
    if (count === 0) return 'Not exercised';
    return count === 1 ? 'Exercised once' : `Exercised ${count} times`;
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

  async lookup(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.query().trim();
    const code = this.code();
    if (!title || !code || this.asking()) return;
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
    if (!selected || !code || this.asking()) return;
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
            equivalentIds: {},
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

  toggleSort(event: Event): void {
    event.stopPropagation();
    if (!this.code()) return;
    this.sortOpen.update((open) => !open);
  }

  chooseSort(sort: ElementSort): void {
    if (!this.code()) return;
    this.sortOpen.set(false);
    this.sort.set(this.sort() === sort ? 'none' : sort);
  }

  openDiscover(event: Event): void {
    event.stopPropagation();
    if (!this.code()) return;
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
    this.applyCatalog(catalog);
  }

  openFilters(event: Event): void {
    event.stopPropagation();
    this.sortOpen.set(false);
    if (this.discoverOpen()) this.closeDiscover();
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

  colorSelected(color: string): boolean {
    return this.colorFilter().includes(color);
  }

  colorSummary(): string {
    return String(this.colorFilter().length);
  }

  chooseColor(color: string): void {
    if (Date.now() - this.colorDragAt < 400) return;
    const current = this.colorFilter();
    const next = current.includes(color)
      ? current.filter((item) => item !== color)
      : [...current, color];
    this.colorFilter.set(next);
  }

  reorderColors(event: CdkDragDrop<string[]>): void {
    this.colorDragAt = Date.now();
    if (event.previousIndex === event.currentIndex) return;
    const colors = [...this.colorOptions()];
    moveItemInArray(colors, event.previousIndex, event.currentIndex);
    this.metadataCatalog.update((catalog) => ({ ...catalog, colors }));
    void replaceElementColorOrder(colors).then((catalog) => this.applyCatalog(catalog));
  }

  clearColor(): void {
    this.colorFilter.set([]);
  }

  clearFilters(): void {
    this.colorFilter.set([]);
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
    this.refreshLeadField();
  }

  onCollectionReplaced(): void {
    if (this.elementId()) this.closeElement();
    this.refreshLeadField();
    void this.reloadElements();
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
      const previous = await readMetadataCatalog();
      const all = await readAllElements();
      const next: StoredElement[] = [];
      for (const element of all) {
        next.push(await saveElement(element, { syncCatalog: false }));
      }
      const catalog = await commitElementCatalog(catalogFromElements(next, previous.colors));
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
    this.applyCatalog(await syncElementColorCatalog());
  }

  private async refreshCatalog(): Promise<void> {
    this.applyCatalog(await readMetadataCatalog());
  }

  private applyCatalog(catalog: ElementCatalog): void {
    this.metadataCatalog.set(catalog);
    const live = new Set(catalog.colors);
    this.colorFilter.update((current) =>
      current.every((color) => live.has(color))
        ? current
        : current.filter((color) => live.has(color)),
    );
  }

  private async load(language: string): Promise<void> {
    const seq = ++this.loadId;
    const code = language.trim().toLowerCase();
    this.playId.set('');
    this.playMode.set(null);
    this.drillId.set('');
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

  private refreshLeadField(): void {
    this.leadFieldKey.set(readDefinitionMetadataFields()[0]?.key ?? '');
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
