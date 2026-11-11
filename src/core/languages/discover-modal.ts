import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  addElement,
  displayTitle,
  formMatchesTerm,
  LEARNABLE_LANGUAGES,
  languageDisplayName,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  parsePassage,
  saveElement,
  type ElementDefinition,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
  type ParsedPassage,
  type StoredElement,
} from 'collection';
import {
  MAX_DISCOVER_INSTRUCTION,
  MAX_METADATA_FIELD_KEY,
  discoverElements,
  readStoredAiCredentials,
  type DiscoveredElement,
} from 'ai';
import { readFieldColor } from '../elements/metadata-colors';
import { rememberTranslationInto, translationInto } from './translation-language';
import { Reveal } from '../elements/reveal';
import {
  readDiscoverSearches,
  rememberDiscoverSearch,
  type DiscoverHit,
  type DiscoverSearch,
  type DiscoverSense,
} from './discover-store';

type DiscoverKind = 'definition' | 'example' | 'form';

type DiscoverSection = {
  id: DiscoverKind;
  title: string;
};

type DiscoverDraft = { key: string; value: string };

type ResultFilter = 'all' | 'new' | 'collected';

const SECTIONS: readonly DiscoverSection[] = [
  { id: 'definition', title: 'Definitions' },
  { id: 'example', title: 'Examples' },
  { id: 'form', title: 'Forms' },
];

const EMPTY_DRAFT: DiscoverDraft = { key: '', value: '' };
const VALUE_MAX = 100;
const RESULT_FILTERS: readonly { id: ResultFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'collected', label: 'Collected' },
];

@Component({
  selector: 'app-discover-modal',
  imports: [Reveal],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Discover"
      (click)="onBackdrop($event)"
    >
      <div class="panel" (click)="onPanel($event)">
        <header class="head">
          <div>
            <h2>Discover</h2>
            @if (languageName(language()); as learning) {
              <p class="learning">{{ learning }}</p>
            }
            <p>Elements to add, with their definitions. A note and metadata narrow the batch.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div class="body">
          <div class="query">
            <div class="note">
              <span>Instruction</span>
              <div class="instruction-field">
                <input
                  class="instruction"
                  type="text"
                  [class.has-clear]="canClear()"
                  [attr.maxlength]="instructionMax"
                  placeholder="Argentine expressions"
                  aria-label="Instruction"
                  [readonly]="locked()"
                  [value]="instruction()"
                  (input)="onInstruction($event)"
                  (keydown.enter)="submit()"
                />
                @if (canClear()) {
                  <button
                    type="button"
                    class="clear-x"
                    aria-label="Clear"
                    title="Clear"
                    [disabled]="busy() || adding()"
                    (click)="clearSearch()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                }
              </div>
            </div>
            <div class="discover-split">
              <button
                type="button"
                class="discover-main"
                [disabled]="!canSearch() || busy() || adding()"
                (click)="submit()"
              >
                {{ results().length ? 'More' : 'Search' }}
                @if (translationTarget(); as code) {
                  <span class="discover-translation">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 8 6 6" />
                      <path d="m4 14 6-6 2-3" />
                      <path d="M2 5h12" />
                      <path d="M7 2h1" />
                      <path d="m22 22-5-10-5 10" />
                      <path d="M14 18h6" />
                    </svg>
                    {{ languageName(code) }}
                  </span>
                }
              </button>
              <button
                type="button"
                class="discover-chevron"
                [class.open]="translationOpen()"
                [attr.aria-expanded]="translationOpen()"
                aria-label="Translation language"
                [disabled]="busy() || adding()"
                (click)="toggleTranslation()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              @if (translationOpen()) {
                <ul class="translation-menu" role="listbox" aria-label="Translation language">
                  <li>
                    <button
                      type="button"
                      role="option"
                      [class.selected]="!translationTarget()"
                      [attr.aria-selected]="!translationTarget()"
                      (click)="chooseTranslation('')"
                    >
                      No translation
                    </button>
                  </li>
                  @for (code of translationLanguages(); track code) {
                    <li>
                      <button
                        type="button"
                        role="option"
                        [class.selected]="code === translationTarget()"
                        [attr.aria-selected]="code === translationTarget()"
                        (click)="chooseTranslation(code)"
                      >
                        {{ languageName(code) }}
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
            <button
              type="button"
              class="filter-btn"
              [class.active]="filtersOpen() || metaCount() > 0"
              [attr.aria-expanded]="filtersOpen()"
              aria-label="Filter by metadata"
              title="Metadata"
              (click)="openFilters()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              @if (metaCount() > 0) {
                <span class="filter-count">{{ metaCount() }}</span>
              }
            </button>
          </div>

          <div class="results">
            <div class="filter-row">
              @if (results().length) {
                <div class="filter-chips" role="group" aria-label="Results">
                  @for (option of resultFilters; track option.id) {
                    <button
                      type="button"
                      class="filter-chip"
                      [class.selected]="resultFilter() === option.id"
                      [attr.aria-pressed]="resultFilter() === option.id"
                      (click)="resultFilter.set(option.id)"
                    >
                      {{ option.label }}
                    </button>
                  }
                </div>
              }
              <button
                type="button"
                class="filter-btn history-btn"
                [class.active]="historyOpen()"
                [attr.aria-expanded]="historyOpen()"
                aria-label="Search history"
                title="History"
                (click)="openHistory()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                @if (searches().length) {
                  <span class="filter-count">{{ searches().length }}</span>
                }
              </button>
            </div>
            @if (error()) {
              <p class="error">{{ error() }}</p>
            } @else if (notice()) {
              <p class="notice">{{ notice() }}</p>
            }

            @if (results().length) {
              <div class="card-scroll">
                @if (visibleResults().length) {
                  <div class="card-list">
                    @for (row of visibleResults(); track row.title) {
                      <article class="card" [class.collected]="!!collectedId(row.title)">
                        <div class="card-head">
                          @if (collectedId(row.title); as id) {
                            <button
                              type="button"
                              class="card-title"
                              [attr.aria-label]="'Open ' + label(row.title)"
                              (click)="open.emit(id)"
                            >
                              {{ label(row.title) }}
                            </button>
                            <span class="tile-mark" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            </span>
                          } @else {
                            <span class="card-title">{{ label(row.title) }}</span>
                            <button
                              type="button"
                              class="tile-add"
                              aria-label="Add"
                              title="Add"
                              [disabled]="adding()"
                              (click)="addHit(row)"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M5 12h14" />
                                <path d="M12 5v14" />
                              </svg>
                            </button>
                          }
                        </div>
                        <ol class="senses">
                          @for (sense of row.senses; track $index) {
                            <li>
                              @let passage = sensePassage(sense);
                              @if (passage.text) {
                                <p class="sense-text">{{ passage.text }}</p>
                              }
                              @if (passage.translations.length) {
                                <ul class="sense-translations">
                                  @for (translation of passage.translations; track $index) {
                                    <li>
                                      <app-reveal [text]="translation.text" />
                                    </li>
                                  }
                                </ul>
                              }
                              @if (senseMeta(sense); as meta) {
                                @if (meta.length) {
                                  <ul class="sense-meta">
                                    @for (entry of meta; track entry.key) {
                                      <li
                                        [class.colored]="entry.color"
                                        [style.--meta-color]="entry.color"
                                      >
                                        <span class="sense-meta-key">{{
                                          metaLabel(entry.key)
                                        }}</span>
                                        <span class="sense-meta-value">{{
                                          metaLabel(entry.value)
                                        }}</span>
                                      </li>
                                    }
                                  </ul>
                                }
                              }
                            </li>
                          }
                        </ol>
                      </article>
                    }
                  </div>
                } @else {
                  <p class="notice">{{ emptyFilterMessage() }}</p>
                }
              </div>
            }
          </div>
        </div>
      </div>

      @if (filtersOpen()) {
        <div
          class="filter-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Metadata"
          (click)="closeFiltersOnBackdrop($event)"
        >
          <div class="filter-sheet" (click)="$event.stopPropagation()">
            <header class="filter-head">
              <div>
                <h3>Metadata</h3>
                <p>Narrow the batch by definition, example, or form.</p>
              </div>
              <button type="button" class="icon-btn" aria-label="Close" (click)="closeFilters()">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>
            <div class="filter-sheet-body">
              @for (section of sections; track section.id) {
                <section class="meta-section" [class.expanded]="expanded() === section.id">
                  <button
                    type="button"
                    class="section-header"
                    [attr.aria-expanded]="expanded() === section.id"
                    (click)="toggleSection(section.id)"
                  >
                    <span class="section-title">
                      {{ section.title }}
                      @if (valueCount(section.id); as selected) {
                        <span class="section-count">{{ selected }}</span>
                      }
                    </span>
                    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  @if (expanded() === section.id) {
                    <div class="section-body">
                      <div class="section-actions">
                        <button
                          type="button"
                          class="link-btn"
                          [disabled]="locked() || valueCount(section.id) === 0"
                          (click)="clearMeta(section.id)"
                        >
                          Clear
                        </button>
                      </div>
                      @if (entries(section.id); as rows) {
                        @if (rows.length) {
                          @for (entry of rows; track entry.key) {
                            <div class="meta-key">
                              <span class="key-label">{{ entry.key }}</span>
                              <div class="meta-values" role="group" [attr.aria-label]="entry.key">
                                @for (value of entry.values; track value) {
                                  <button
                                    type="button"
                                    class="meta-value"
                                    [class.selected]="selected(section.id, entry.key, value)"
                                    [attr.aria-pressed]="selected(section.id, entry.key, value)"
                                    [attr.aria-disabled]="locked() ? true : null"
                                    (click)="toggleValue(section.id, entry.key, value)"
                                  >
                                    {{ value }}
                                  </button>
                                }
                              </div>
                            </div>
                          }
                        } @else {
                          <p class="hint">No saved values yet. Type a key and a value.</p>
                        }
                      }
                      <form class="constraint" (submit)="addConstraint(section.id, $event)">
                        <input
                          type="text"
                          placeholder="Key"
                          aria-label="Metadata key"
                          [attr.maxlength]="keyMax"
                          [disabled]="locked()"
                          [value]="draft(section.id).key"
                          (input)="setDraft(section.id, 'key', $event)"
                        />
                        <input
                          type="text"
                          placeholder="Value"
                          aria-label="Metadata value"
                          [attr.maxlength]="valueMax"
                          [disabled]="locked()"
                          [value]="draft(section.id).value"
                          (input)="setDraft(section.id, 'value', $event)"
                        />
                        <button type="submit" [disabled]="locked() || !canAdd(section.id)">
                          Add
                        </button>
                      </form>
                    </div>
                  }
                </section>
              }
            </div>
            <footer class="filter-foot">
              <button type="button" class="discover-btn" (click)="closeFilters()">Done</button>
            </footer>
          </div>
        </div>
      }

      @if (historyOpen()) {
        <div
          class="filter-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Search history"
          (click)="closeHistoryOnBackdrop($event)"
        >
          <div class="filter-sheet" (click)="$event.stopPropagation()">
            <header class="filter-head">
              <div>
                <h3>History</h3>
                <p>Saved searches for this language.</p>
              </div>
              <button type="button" class="icon-btn" aria-label="Close" (click)="closeHistory()">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>
            <div class="filter-sheet-body">
              @if (searches().length) {
                <div class="history-list" role="list">
                  @for (search of searches(); track search.id) {
                    <button
                      type="button"
                      class="history-item"
                      role="listitem"
                      [class.selected]="search.id === activeId()"
                      [attr.aria-pressed]="search.id === activeId()"
                      [disabled]="busy() || adding()"
                      (click)="chooseSearch(search.id)"
                    >
                      <span class="search-label">{{ searchLabel(search) }}</span>
                      <span class="search-count">{{ search.elements.length }}</span>
                    </button>
                  }
                </div>
              } @else {
                <p class="hint">No saved searches.</p>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .backdrop {
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

    .panel {
      box-sizing: border-box;
      width: min(40rem, 100%);
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
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .head {
      display: flex;
      flex-shrink: 0;
    }

    .head {
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
    }

    h2 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .head p.learning {
      margin: 0.2rem 0 0;
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 650;
      line-height: 1.2;
    }

    .head p,
    .hint,
    .notice,
    .error {
      margin: 0.4rem 0 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .error {
      color: var(--danger);
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

    .icon-btn svg,
    .chevron {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .body {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: hidden;
      padding: 0 1.15rem 1rem;
    }

    .query {
      flex-shrink: 0;
    }

    .results {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: hidden;
    }

    .query {
      display: flex;
      align-items: flex-end;
      gap: 0.45rem;
    }

    .note {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
    }

    .discover-split {
      position: relative;
      display: inline-flex;
      flex: none;
      align-items: stretch;
      align-self: flex-end;
      border-radius: 999px;
      background: var(--accent);
    }

    .discover-split:hover:not(:has(:disabled)) {
      background: var(--accent-hover);
    }

    .discover-main,
    .discover-chevron {
      border: 0;
      background: transparent;
      color: white;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }

    .discover-main {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.12rem;
      border-radius: 999px 0 0 999px;
      padding: 0.4rem 1rem 0.42rem;
      font-size: 0.9375rem;
      line-height: 1.1;
    }

    .discover-translation {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      color: white;
      font-size: 0.72rem;
      font-weight: 650;
      line-height: 1;
    }

    .discover-translation svg,
    .discover-chevron svg {
      display: block;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .discover-translation svg {
      width: 0.72rem;
      height: 0.72rem;
    }

    .discover-chevron svg {
      width: 1rem;
      height: 1rem;
    }

    .discover-chevron {
      display: grid;
      place-items: center;
      border-left: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 0 999px 999px 0;
      padding: 0 0.75rem;
    }

    .discover-chevron svg {
      transition: transform 0.15s ease;
    }

    .discover-chevron.open svg {
      transform: rotate(180deg);
    }

    .discover-main:disabled,
    .discover-chevron:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .translation-menu {
      position: absolute;
      z-index: 6;
      top: calc(100% + 0.3rem);
      right: 0;
      display: flex;
      flex-direction: column;
      width: max-content;
      min-width: 8.25rem;
      max-height: min(8.25rem, calc(40dvh - 5.5rem));
      margin: 0;
      padding: 0.2rem;
      overflow: auto;
      overscroll-behavior: contain;
      list-style: none;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
    }

    .translation-menu button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.78rem;
      line-height: 1.2;
      text-align: left;
      padding: 0.22rem 0.5rem;
      cursor: pointer;
    }

    .translation-menu button:hover {
      background: rgba(var(--accent-rgb), 0.1);
    }

    .translation-menu button.selected {
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
    }

    .note span,
    .key-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .instruction,
    .constraint input {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 0.7rem;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      padding: 0.65rem 0.75rem;
    }

    .instruction-field {
      position: relative;
    }

    .instruction {
      height: 2.4rem;
    }

    .instruction.has-clear {
      padding-right: 2.15rem;
    }

    .clear-x {
      position: absolute;
      top: 50%;
      right: 0.3rem;
      display: grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transform: translateY(-50%);
    }

    .clear-x svg {
      display: block;
      width: 0.85rem;
      height: 0.85rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .clear-x:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.16);
      color: var(--text);
    }

    .instruction[readonly] {
      cursor: default;
    }

    .meta-value[aria-disabled='true'] {
      cursor: default;
    }

    .meta-value[aria-disabled='true']:hover {
      background: transparent;
    }

    .meta-value.selected[aria-disabled='true']:hover {
      background: rgba(var(--accent-rgb), 0.16);
    }

    .instruction:focus,
    .constraint input:focus {
      outline: none;
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .filter-btn {
      position: relative;
      display: grid;
      flex: none;
      place-items: center;
      width: 2.4rem;
      height: 2.4rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text-muted);
      cursor: pointer;
    }

    .filter-btn svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .filter-btn:hover:not(:disabled) {
      color: var(--text);
      border-color: rgba(var(--accent-rgb), 0.4);
    }

    .filter-btn.active {
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
    }

    .filter-backdrop {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.55);
    }

    .filter-sheet {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: min(36rem, 100%);
      max-height: calc(100dvh - 4rem);
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .filter-head,
    .filter-foot {
      display: flex;
      flex-shrink: 0;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1rem;
    }

    .filter-head h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .filter-head p {
      margin: 0.3rem 0 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .filter-sheet-body {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: auto;
      padding: 0 1rem 1rem;
    }

    .filter-foot {
      justify-content: flex-end;
      border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    }

    .filter-count {
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
    }

    .meta-section {
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
      gap: 0.45rem;
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

    .chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.18s ease;
    }

    .meta-section.expanded .chevron {
      transform: rotate(180deg);
    }

    .section-body {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0 0.75rem 0.85rem;
    }

    .section-actions {
      display: flex;
      justify-content: flex-end;
    }

    .meta-key {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .meta-values {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .meta-value,
    .constraint button,
    .filter-chip,
    .tile-add,
    .link-btn,
    .discover-btn {
      font: inherit;
      cursor: pointer;
    }

    .meta-value {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text);
      padding: 0.35rem 0.7rem;
      font-size: 0.78rem;
      font-weight: 650;
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

    .constraint {
      display: flex;
      gap: 0.35rem;
    }

    .constraint input {
      flex: 1;
      min-width: 0;
      padding: 0.45rem 0.65rem;
    }

    .constraint button {
      flex: none;
      border: 0;
      border-radius: 999px;
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.4rem 0.75rem;
    }

    .link-btn {
      border: 0;
      background: transparent;
      color: var(--accent-text);
      font-size: 0.76rem;
      font-weight: 650;
      padding: 0.2rem 0.3rem;
      border-radius: 0.35rem;
    }

    .link-btn:hover:not(:disabled) {
      background: rgba(var(--accent-rgb), 0.1);
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .history-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .history-item {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      border: 0;
      border-radius: 0.8rem;
      padding: 0.7rem 0.8rem;
      background: rgba(127, 127, 127, 0.12);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 650;
      text-align: left;
      cursor: pointer;
    }

    .history-item.selected {
      background: rgba(var(--accent-rgb), 0.18);
      box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.55);
    }

    .search-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-count {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 750;
    }

    .filter-row {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.6rem;
      padding-top: 0.4rem;
    }

    .card-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .filter-chips {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 0.4rem;
      min-width: 0;
    }

    .history-btn {
      margin-left: auto;
      width: 1.9rem;
      height: 1.9rem;
      border-radius: 0.55rem;
    }

    .history-btn svg {
      width: 0.8rem;
      height: 0.8rem;
    }

    .history-btn .filter-count {
      top: -0.28rem;
      right: -0.2rem;
    }

    .filter-chip {
      border: 0;
      border-radius: 999px;
      padding: 0.4rem 0.75rem;
      background: rgba(127, 127, 127, 0.12);
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 650;
    }

    .filter-chip.selected {
      background: rgba(var(--accent-rgb), 0.18);
      box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.55);
    }

    .card-list {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      min-width: 0;
      margin: 0;
      padding: 0.75rem 0.8rem;
      border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-left: 3px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      color: var(--text);
    }

    .card.collected {
      background: color-mix(in srgb, var(--accent) 22%, var(--surface));
      border-color: color-mix(in srgb, var(--accent) 52%, transparent);
      border-left-color: var(--accent);
    }

    .card-head {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .card-title {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: inherit;
      padding: 0;
      font: inherit;
      font-size: 1.05rem;
      font-weight: 700;
      line-height: 1.25;
      text-align: left;
    }

    button.card-title {
      cursor: pointer;
    }

    .senses {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sense-text {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.45;
    }

    .sense-translations,
    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.35rem 0 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.12);
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      line-height: 1.35;
    }

    .sense-meta li.colored {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: color-mix(in srgb, var(--meta-color) 30%, var(--surface-2));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--meta-color) 62%, transparent);
      color: var(--meta-color);
    }

    .sense-meta-key {
      margin-right: 0.25rem;
      color: var(--text-muted);
      font-weight: 700;
    }

    .sense-meta li.colored .sense-meta-key {
      margin-right: 0;
      color: var(--meta-color);
    }

    .sense-meta-value {
      color: var(--text);
      font-weight: 650;
    }

    .tile-add,
    .tile-mark {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.55rem;
      height: 1.55rem;
      color: var(--accent-text);
    }

    .tile-add {
      border: 0;
      border-radius: 999px;
      padding: 0;
      background: rgba(var(--accent-rgb), 0.16);
    }

    .tile-add svg,
    .tile-mark svg {
      display: block;
      width: 0.85rem;
      height: 0.85rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .discover-btn {
      flex: none;
      height: 2.4rem;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font-size: 0.88rem;
      font-weight: 700;
      padding: 0 1.1rem;
    }

    .discover-btn:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .panel {
        width: 100%;
        height: calc(100dvh - 1.3rem);
        max-height: calc(100dvh - 1.3rem);
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }

      .filter-backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .filter-sheet {
        width: 100%;
        max-height: calc(100dvh - 1.3rem);
        border-radius: 14px 14px 0 0;
      }

      .constraint {
        flex-wrap: wrap;
      }
    }
  `,
})
export class DiscoverModal implements OnInit {
  readonly language = input.required<string>();
  readonly catalog = input.required<ElementMetadataIndexes>();
  readonly elements = input.required<readonly StoredElement[]>();
  readonly closed = output<void>();
  readonly added = output<void>();
  readonly open = output<string>();

  readonly sections = SECTIONS;
  readonly resultFilters = RESULT_FILTERS;
  readonly instructionMax = MAX_DISCOVER_INSTRUCTION;
  readonly keyMax = MAX_METADATA_FIELD_KEY;
  readonly valueMax = VALUE_MAX;

  readonly instruction = signal('');
  readonly translationInto = translationInto;
  readonly filtersOpen = signal(false);
  readonly historyOpen = signal(false);
  readonly translationOpen = signal(false);
  readonly expanded = signal<DiscoverKind | null>(null);
  readonly definitionMeta = signal<ElementMetadataVariability>({});
  readonly exampleMeta = signal<ElementMetadataVariability>({});
  readonly formMeta = signal<ElementMetadataVariability>({});
  readonly drafts = signal<Record<DiscoverKind, DiscoverDraft>>({
    definition: { ...EMPTY_DRAFT },
    example: { ...EMPTY_DRAFT },
    form: { ...EMPTY_DRAFT },
  });
  readonly searches = signal<DiscoverSearch[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly results = signal<DiscoverHit[]>([]);
  readonly resultFilter = signal<ResultFilter>('all');
  readonly busy = signal(false);
  readonly adding = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly matchIds = computed(() => {
    const elements = this.elements();
    const ids = new Map<string, string>();
    for (const row of this.results()) {
      const named = elements.find((element) => sameTitle(element.title, row.title));
      const match = named ?? elements.find((element) => elementCoversTitle(element, row.title));
      if (match) ids.set(row.title, match.id);
    }
    return ids;
  });
  readonly metaCount = computed(
    () => this.valueCount('definition') + this.valueCount('example') + this.valueCount('form'),
  );
  readonly visibleResults = computed(() => {
    const filter = this.resultFilter();
    return this.results().filter((row) => {
      const collected = this.matchIds().has(row.title);
      if (filter === 'new') return !collected;
      if (filter === 'collected') return collected;
      return true;
    });
  });
  private job = 0;

  constructor() {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!this.historyOpen() && !this.filtersOpen() && !this.translationOpen())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.translationOpen()) this.translationOpen.set(false);
      else if (this.historyOpen()) this.historyOpen.set(false);
      else this.filtersOpen.set(false);
    };
    document.addEventListener('keydown', onEscape, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', onEscape, true));
  }

  ngOnInit(): void {
    this.restore(this.language());
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  fieldValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  locked(): boolean {
    return this.activeId() !== null;
  }

  onInstruction(event: Event): void {
    if (this.locked()) return;
    this.instruction.set(this.fieldValue(event));
  }

  openFilters(): void {
    this.historyOpen.set(false);
    this.translationOpen.set(false);
    this.filtersOpen.set(true);
  }

  openHistory(): void {
    this.filtersOpen.set(false);
    this.translationOpen.set(false);
    this.historyOpen.set(true);
  }

  closeHistory(): void {
    this.historyOpen.set(false);
  }

  closeHistoryOnBackdrop(event: MouseEvent): void {
    event.stopPropagation();
    if (event.target === event.currentTarget) this.historyOpen.set(false);
  }

  chooseSearch(id: string): void {
    this.loadSearch(id);
    this.historyOpen.set(false);
  }

  closeFilters(): void {
    this.filtersOpen.set(false);
  }

  closeFiltersOnBackdrop(event: MouseEvent): void {
    event.stopPropagation();
    if (event.target === event.currentTarget) this.filtersOpen.set(false);
  }

  toggleSection(kind: DiscoverKind): void {
    this.expanded.update((current) => (current === kind ? null : kind));
  }

  entries(kind: DiscoverKind): { key: string; values: string[] }[] {
    const shown = mergeMetadataVariability(this.catalogPart(kind), this.meta(kind));
    return Object.entries(shown).map(([key, values]) => ({ key, values }));
  }

  valueCount(kind: DiscoverKind): number {
    return Object.values(this.meta(kind)).reduce((sum, values) => sum + values.length, 0);
  }

  selected(kind: DiscoverKind, key: string, value: string): boolean {
    return (this.meta(kind)[key] ?? []).includes(value);
  }

  toggleValue(kind: DiscoverKind, key: string, value: string): void {
    if (this.locked()) return;
    const current = this.meta(kind);
    const values = current[key] ?? [];
    const nextValues = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    const next = { ...current };
    if (nextValues.length) next[key] = nextValues;
    else delete next[key];
    this.setMeta(kind, normalizeMetadataVariability(next));
  }

  clearMeta(kind: DiscoverKind): void {
    if (this.locked()) return;
    this.setMeta(kind, {});
  }

  draft(kind: DiscoverKind): DiscoverDraft {
    return this.drafts()[kind];
  }

  setDraft(kind: DiscoverKind, field: keyof DiscoverDraft, event: Event): void {
    if (this.locked()) return;
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({
      ...drafts,
      [kind]: { ...drafts[kind], [field]: value },
    }));
  }

  canAdd(kind: DiscoverKind): boolean {
    const draft = this.draft(kind);
    return draft.key.trim().length > 0 && draft.value.trim().length > 0;
  }

  addConstraint(kind: DiscoverKind, event: Event): void {
    event.preventDefault();
    if (this.locked() || !this.canAdd(kind)) return;
    const draft = this.draft(kind);
    const added = normalizeMetadataVariability({ [draft.key]: [draft.value] });
    const key = Object.keys(added)[0];
    const value = key ? added[key]?.[0] : '';
    if (!key || !value) return;
    const current = { ...this.meta(kind) };
    const values = current[key] ?? [];
    if (!values.includes(value)) current[key] = [...values, value];
    this.setMeta(kind, normalizeMetadataVariability(current));
    this.drafts.update((drafts) => ({ ...drafts, [kind]: { ...EMPTY_DRAFT } }));
  }

  label(title: string): string {
    return displayTitle(title, this.language());
  }

  searchLabel(search: DiscoverSearch): string {
    return search.instruction.trim() || 'Any titles';
  }

  sensePassage(sense: DiscoverSense): ParsedPassage {
    const passage = parsePassage(sense.text);
    return { ...passage, text: displayTitle(passage.text, this.language()) };
  }

  senseMeta(sense: DiscoverSense): { key: string; value: string; color: string | null }[] {
    return Object.entries(sense.metadata).map(([key, value]) => ({
      key,
      value,
      color: readFieldColor('definitions', key),
    }));
  }

  metaLabel(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  loadSearch(id: string): void {
    if (this.busy() || this.adding()) return;
    const search = this.searches().find((item) => item.id === id);
    if (!search) return;
    this.job += 1;
    this.busy.set(false);
    this.error.set('');
    this.notice.set('');
    this.apply(search);
  }

  collectedId(title: string): string {
    return this.matchIds().get(title) ?? '';
  }

  emptyFilterMessage(): string {
    return this.resultFilter() === 'collected'
      ? 'None of these are in the collection yet.'
      : 'All of these are already in the collection.';
  }

  languageName(code: string): string {
    return languageDisplayName(code);
  }

  translationLanguages(): string[] {
    const learning = this.language().trim().toLowerCase();
    return LEARNABLE_LANGUAGES.filter((code) => code !== learning);
  }

  toggleTranslation(): void {
    if (this.busy() || this.adding()) return;
    this.translationOpen.update((open) => !open);
  }

  chooseTranslation(code: string): void {
    rememberTranslationInto(code);
    this.translationOpen.set(false);
  }

  onPanel(event: MouseEvent): void {
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.discover-split')) this.translationOpen.set(false);
  }

  private translationTarget(): string {
    const learning = this.language().trim().toLowerCase();
    const into = this.translationInto().trim().toLowerCase();
    if (!into || into === learning) return '';
    return LEARNABLE_LANGUAGES.includes(into as (typeof LEARNABLE_LANGUAGES)[number]) ? into : '';
  }

  canClear(): boolean {
    return (
      this.instruction().trim().length > 0 || this.results().length > 0 || this.metaCount() > 0
    );
  }

  canSearch(): boolean {
    return this.instruction().trim().length > 0 || this.results().length > 0;
  }

  clearSearch(): void {
    if (this.busy() || this.adding()) return;
    this.notice.set('');
    this.error.set('');
    this.clearDraft();
  }

  submit(): void {
    this.translationOpen.set(false);
    if (this.results().length) this.more();
    else this.search();
  }

  search(): void {
    if (this.busy() || this.adding() || !this.instruction().trim()) return;
    this.notice.set('');
    void this.load(false);
  }

  more(): void {
    if (this.busy() || this.adding() || !this.results().length || !this.activeId()) return;
    this.notice.set('');
    void this.load(true);
  }

  async addHit(row: DiscoverHit): Promise<void> {
    if (this.adding() || this.collectedId(row.title)) return;
    const language = this.language().trim();
    if (!language) return;
    this.adding.set(true);
    this.error.set('');
    try {
      await saveDiscoveredElement(language, row);
      this.added.emit();
    } catch {
      this.error.set('Could not add that element.');
    } finally {
      this.adding.set(false);
    }
  }

  private async load(more: boolean): Promise<void> {
    const language = this.language().trim();
    if (!language || this.busy()) return;
    const active = more ? this.searches().find((item) => item.id === this.activeId()) : undefined;
    const query = active
      ? {
          instruction: active.instruction,
          definition: active.definition,
          example: active.example,
          form: active.form,
        }
      : this.query();
    const continuing = active !== undefined;
    const prior = continuing ? this.results() : [];
    const activeId = active?.id ?? null;
    const blocked = continuing ? prior : this.results();
    const job = ++this.job;
    this.busy.set(true);
    this.error.set('');
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      this.busy.set(false);
      return;
    }
    try {
      const found = await discoverElements({
        language,
        translation: this.translationTarget(),
        instruction: query.instruction,
        metadata: {
          definition: query.definition,
          example: query.example,
          form: query.form,
        },
        excludeTitles: this.excludeTitles(blocked),
      });
      if (job !== this.job) return;
      const fresh = found.filter(
        (item) => !blocked.some((row) => sameTitle(row.title, item.title)),
      );
      if (!fresh.length) {
        this.notice.set(prior.length ? 'Nothing new in that batch.' : 'Nothing new to add.');
        return;
      }
      const search: DiscoverSearch = {
        id: activeId ?? crypto.randomUUID(),
        instruction: query.instruction.trim(),
        definition: query.definition,
        example: query.example,
        form: query.form,
        elements: [...prior, ...fresh.map(hitFromDiscovered)],
        updatedAt: Date.now(),
      };
      this.notice.set('');
      this.searches.set(rememberDiscoverSearch(language, search));
      const stored = this.searches().find((item) => item.id === search.id) ?? search;
      this.apply(stored, continuing);
    } catch {
      if (job !== this.job) return;
      this.error.set('Could not discover elements.');
    } finally {
      if (job === this.job) this.busy.set(false);
    }
  }

  private excludeTitles(prior: readonly DiscoverHit[]): string[] {
    const collected = [...this.elements()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((element) => element.title);
    return [...prior.map((row) => row.title), ...collected];
  }

  private restore(language: string): void {
    const searches = readDiscoverSearches(language);
    this.searches.set(searches);
    const latest = searches[0];
    if (latest) this.apply(latest);
    else this.clearDraft();
  }

  private apply(search: DiscoverSearch, keepFilter = false): void {
    this.activeId.set(search.id);
    this.instruction.set(search.instruction);
    this.definitionMeta.set(search.definition);
    this.exampleMeta.set(search.example);
    this.formMeta.set(search.form);
    this.results.set(search.elements);
    if (!keepFilter) this.resultFilter.set('all');
  }

  private clearDraft(): void {
    this.activeId.set(null);
    this.results.set([]);
    this.instruction.set('');
    this.definitionMeta.set({});
    this.exampleMeta.set({});
    this.formMeta.set({});
    this.resultFilter.set('all');
  }

  private query(): Pick<DiscoverSearch, 'instruction' | 'definition' | 'example' | 'form'> {
    return {
      instruction: this.instruction(),
      definition: this.definitionMeta(),
      example: this.exampleMeta(),
      form: this.formMeta(),
    };
  }

  private catalogPart(kind: DiscoverKind): ElementMetadataVariability {
    const catalog = this.catalog();
    if (kind === 'definition') return catalog.definitionMetadata;
    if (kind === 'example') return catalog.exampleMetadata;
    return catalog.formMetadata;
  }

  private meta(kind: DiscoverKind): ElementMetadataVariability {
    if (kind === 'definition') return this.definitionMeta();
    if (kind === 'example') return this.exampleMeta();
    return this.formMeta();
  }

  private setMeta(kind: DiscoverKind, next: ElementMetadataVariability): void {
    if (kind === 'definition') this.definitionMeta.set(next);
    else if (kind === 'example') this.exampleMeta.set(next);
    else this.formMeta.set(next);
  }
}

function hitFromDiscovered(element: DiscoveredElement): DiscoverHit {
  return {
    title: element.title,
    senses: element.senses.map((sense) => ({
      text: sense.text,
      metadata: { ...sense.metadata },
    })),
  };
}

async function saveDiscoveredElement(language: string, hit: DiscoverHit): Promise<void> {
  const created = await addElement(language, hit.title);
  if (created.definitions.length || !hit.senses.length) return;
  const definitions: ElementDefinition[] = hit.senses.map((sense) => ({
    text: sense.text,
    equivalentId: null,
    forms: [],
    examples: [],
    metadata: { ...sense.metadata },
    log: [],
  }));
  await saveElement({ ...created, definitions });
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

/** True when the title or any stored form matches, including a form pattern. */
function elementCoversTitle(element: StoredElement, title: string): boolean {
  if (formMatchesTerm(element.title, title)) return true;
  for (const definition of element.definitions) {
    for (const form of definition.forms) {
      const text = form.text.trim();
      if (!text) continue;
      if (sameTitle(text, title) || formMatchesTerm(text, title)) return true;
    }
  }
  return false;
}
