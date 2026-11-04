import {
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, CanActivateFn, Router, RouterLink } from '@angular/router';
import { ElementModal } from '../elements/element-modal';
import { ModeIcon } from '../elements/mode-icon';
import { LanguageAiSettings } from './language-ai-settings';
import { generateElementFromSelection } from 'ai';
import {
  addElement,
  compareElements,
  DEFAULT_ELEMENT_SORT,
  displayTitle,
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesMinimums,
  elementMatchesPrefix,
  elementModeLabel,
  modePointsThrough,
  elementPrefixSearch,
  isValidForm,
  languageDisplayName,
  parseElementMinimum,
  parseElementSort,
  readElements,
  readLanguages,
  saveElement,
  resolveHighlightColor,
  resolveHighlightStyle,
  type ElementDefinition,
  type ElementSearch,
  type ElementSearchPart,
  type ElementSort,
  type StoredElement,
} from 'collection';

const ELEMENT_SKELETONS = [0, 1, 2, 3, 4, 5, 6, 7];

export const openSavedLanguage: CanActivateFn = async (route) => {
  const router = inject(Router);
  const code = String(route.paramMap.get('code') ?? '')
    .trim()
    .toLowerCase();
  const languages = await readLanguages();
  if (languages.some((language) => language.code === code)) return true;
  return router.createUrlTree(['/']);
};

@Component({
  selector: 'app-language-page',
  imports: [RouterLink, ElementModal, ModeIcon, LanguageAiSettings],
  template: `
    <main>
      <header>
        <a class="back" routerLink="/" aria-label="Back to languages">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>
        <h1>{{ name() }}</h1>
        <div class="header-actions">
          <button
            type="button"
            class="settings"
            aria-label="Definition and example settings"
            title="Definition and example settings"
            (click)="openAiSettings()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 21v-7" />
              <path d="M4 10V3" />
              <path d="M12 21v-9" />
              <path d="M12 8V3" />
              <path d="M20 21v-5" />
              <path d="M20 12V3" />
              <path d="M2 14h4" />
              <path d="M10 8h4" />
              <path d="M18 16h4" />
            </svg>
          </button>
          <a class="settings" routerLink="/settings" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </a>
        </div>
      </header>

      <section class="entries-toolbar" aria-label="Search">
        <form class="search-bar" autocomplete="off" (submit)="lookup($event)">
          <input
            class="entry-input"
            type="search"
            autocomplete="off"
            [value]="query()"
            [attr.maxlength]="maxSearchLength"
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
              <button type="submit" class="search-add" aria-label="Add entry" [disabled]="asking()">
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

      @if (ready()) {
        <p class="list-count">{{ countLabel() }}</p>
      }

      @if (!ready()) {
        <ul class="elements" aria-hidden="true">
          @for (item of skeletons; track item) {
            <li class="element skeleton">
              <span class="bone bone-title"></span>
            </li>
          }
        </ul>
      } @else if (visible().length) {
        <ul class="elements">
          @for (element of visible(); track element.id) {
            <li>
              <div
                class="element"
                [style.--highlight-color]="highlightColor(element)"
                [style.--highlight-style]="highlightStyle(element)"
              >
                <button type="button" class="element-open" (click)="openElement(element.id)">
                  <span class="title">
                    @for (part of highlight(element.title); track $index) {
                      @if (part.hit) {
                        <mark class="hit">{{ part.text }}</mark>
                      } @else {
                        <span>{{ part.text }}</span>
                      }
                    }
                  </span>
                  <span class="stats">
                  <span
                    class="stat"
                    [class.empty]="element.equivalents.length === 0"
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
                    [class.empty]="element.definitions.length === 0"
                    [attr.aria-label]="
                      element.definitions.length === 1
                        ? '1 definition'
                        : element.definitions.length + ' definitions'
                    "
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
                </span>
              </button>
              <div class="mode-stack">
                <button
                  type="button"
                  class="mode-icon"
                  [attr.aria-label]="modeLabel(element.mode)"
                  (click)="openElement(element.id)"
                >
                  <app-mode-icon [mode]="element.mode" />
                </button>
                <div
                  class="mode-points"
                  role="group"
                  [attr.aria-label]="modeLabel(element.mode) + ' points'"
                >
                @for (filled of element.modePoints[element.mode]; track $index) {
                  <button
                    type="button"
                    class="mode-point"
                    [class.filled]="filled"
                    [attr.aria-pressed]="filled"
                    [attr.aria-label]="modeLabel(element.mode) + ' point ' + ($index + 1)"
                    (click)="setModePoint(element, $index)"
                  ></button>
                }
              </div>
              </div>
            </div>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ elements().length ? 'No matching elements.' : 'No elements yet.' }}</p>
      }

      @if (aiSettingsOpen()) {
        <app-language-ai-settings
          [language]="code()"
          [languageName]="name()"
          (closed)="closeAiSettings()"
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
                  Keep elements with at least this many translations and definitions.
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
                  [disabled]="filterCount() === 0"
                  (click)="clearFilters()"
                >
                  Clear filters
                </button>
              </div>

              <section class="filter-section" [class.expanded]="expanded() === 'translations'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'translations'"
                  (click)="toggleSection('translations')"
                >
                  <span class="section-title">
                    Translations
                    @if (minTranslations(); as count) {
                      <span class="section-count">{{ count }}</span>
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
                        [disabled]="minTranslations() == null"
                        (click)="clearMinimum('translations')"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">At least this many translations.</p>
                    <div class="count-stepper">
                      <button
                        type="button"
                        aria-label="Fewer translations"
                        [disabled]="minTranslations() == null"
                        (click)="stepMinimum('translations', -1)"
                      >
                        −
                      </button>
                      <span>{{ minTranslations() ?? 'Any' }}</span>
                      <button
                        type="button"
                        aria-label="More translations"
                        [disabled]="minTranslations() === 99"
                        (click)="stepMinimum('translations', 1)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'definitions'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'definitions'"
                  (click)="toggleSection('definitions')"
                >
                  <span class="section-title">
                    Definitions
                    @if (minDefinitions(); as count) {
                      <span class="section-count">{{ count }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'definitions') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="minDefinitions() == null"
                        (click)="clearMinimum('definitions')"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">At least this many definitions.</p>
                    <div class="count-stepper">
                      <button
                        type="button"
                        aria-label="Fewer definitions"
                        [disabled]="minDefinitions() == null"
                        (click)="stepMinimum('definitions', -1)"
                      >
                        −
                      </button>
                      <span>{{ minDefinitions() ?? 'Any' }}</span>
                      <button
                        type="button"
                        aria-label="More definitions"
                        [disabled]="minDefinitions() === 99"
                        (click)="stepMinimum('definitions', 1)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                }
              </section>
            </div>

            <footer class="filter-footer">
              <button type="button" class="done-btn" (click)="closeFilters()">Done</button>
            </footer>
          </div>
        </div>
      }

      @if (opened(); as element) {
        <app-element-modal
          [element]="element"
          [collection]="elements()"
          [canGoBack]="canGoBack()"
          (closed)="closeElement()"
          (changed)="replaceElement($event)"
          (deleted)="onElementDeleted()"
          (visit)="visitElement($event)"
          (back)="backElement()"
          (addSelection)="addFromSelection($event)"
          (addPrepared)="addPrepared($event)"
        />
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      min-height: 100dvh;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 1rem 1.25rem 1.5rem;
    }

    header {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .back {
      display: inline-flex;
      flex: none;
      align-items: center;
      padding: 0.3rem;
      border-radius: 999px;
      color: var(--accent-text);
      font-size: 1rem;
      font-weight: 650;
      text-decoration: none;
    }

    .back:hover {
      background: rgba(139, 144, 165, 0.16);
    }

    .back svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    h1 {
      flex: 1;
      margin: 0;
      min-width: 0;
      overflow: hidden;
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-actions {
      display: flex;
      flex: none;
      align-items: center;
      gap: 0.2rem;
    }

    .settings {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      text-decoration: none;
      cursor: pointer;
    }

    .settings:hover {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .settings svg {
      width: 1.15rem;
      height: 1.15rem;
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

    .toolbar-icon-btn:hover {
      color: var(--text);
      border-color: rgba(var(--accent-rgb), 0.4);
    }

    .toolbar-icon-btn.active {
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
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
      margin: -0.3rem 0 0;
      font-size: 0.78rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
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

    .element {
      box-sizing: border-box;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      border: 1px solid color-mix(in srgb, var(--highlight-color, var(--accent)) 28%, transparent);
      border-left: 3px solid var(--highlight-color, var(--accent));
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--highlight-color, var(--accent)) 14%, var(--surface));
      color: inherit;
      font: inherit;
      text-align: left;
    }

    .element:hover {
      background: var(--surface);
    }

    .element-open {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.55rem;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .title {
      min-width: 0;
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      text-decoration-line: underline;
      text-decoration-style: var(--highlight-style, solid);
      text-decoration-color: var(--highlight-color, #6c63ff);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
    }

    .mode-stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: none;
      gap: 0.15rem;
    }

    .mode-icon {
      display: grid;
      place-items: center;
      width: 1.45rem;
      height: 1.45rem;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .mode-icon app-mode-icon {
      width: 100%;
      height: 100%;
    }

    .mode-points {
      display: flex;
      justify-content: center;
      gap: 0.02rem;
    }

    .mode-point {
      display: grid;
      place-items: center;
      width: 0.85rem;
      height: 0.85rem;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      cursor: pointer;
    }

    .mode-point::before {
      content: '';
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 999px;
      box-shadow: inset 0 0 0 1.5px rgba(139, 144, 165, 0.75);
    }

    .mode-point.filled::before {
      background: var(--accent);
      box-shadow: none;
    }

    .stats {
      display: flex;
      align-items: center;
      gap: 0.9rem;
    }

    .stat {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .stat.empty {
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
      gap: 0.55rem;
      border-left-color: color-mix(in srgb, var(--text) 7%, transparent);
    }

    .bone {
      display: block;
      height: 0.7rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 10%, transparent);
    }

    .bone-title {
      width: 58%;
      height: 0.95rem;
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
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .filter-panel {
      width: min(520px, 100%);
      max-height: calc(100dvh - 2.5rem);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
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
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: auto;
      padding: 1rem 1.15rem 1.15rem;
    }

    .panel-toolbar {
      display: flex;
      justify-content: flex-end;
    }

    .filter-section {
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

    .section-chevron {
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

    .count-stepper span {
      min-width: 2.4rem;
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
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
      .filter-backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .filter-panel {
        width: 100%;
        max-height: calc(100dvh - 1.3rem);
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class LanguagePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private loadId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollLock = '';

  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly modeLabel = elementModeLabel;
  readonly asking = signal(false);
  readonly lookupError = signal('');
  readonly skeletons = ELEMENT_SKELETONS;
  readonly sortOptions: { value: ElementSort; label: string }[] = [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'created-desc', label: 'Most recent' },
    { value: 'created-asc', label: 'Least recent' },
    { value: 'definitions-desc', label: 'Most definitions' },
    { value: 'translations-desc', label: 'Most translations' },
  ];
  readonly code = signal('');
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly sort = signal<ElementSort>(DEFAULT_ELEMENT_SORT);
  readonly minTranslations = signal<number | null>(null);
  readonly minDefinitions = signal<number | null>(null);
  readonly sortOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly aiSettingsOpen = signal(false);
  readonly expanded = signal<'translations' | 'definitions' | null>('translations');
  readonly elementId = signal('');
  readonly trail = signal<string[]>([]);
  readonly canGoBack = computed(() => this.trail().length > 1);
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly filterCount = computed(
    () => (this.minTranslations() == null ? 0 : 1) + (this.minDefinitions() == null ? 0 : 1),
  );
  readonly sortActive = computed(() => {
    const sort = this.sort();
    return sort !== DEFAULT_ELEMENT_SORT && sort !== 'none';
  });
  readonly visible = computed(() => {
    const search = this.search();
    const translations = this.minTranslations();
    const definitions = this.minDefinitions();
    const matched = this.elements().filter((element) => {
      if (search.mode === 'prefix' && !elementMatchesPrefix(element, search.value)) return false;
      return elementMatchesMinimums(element, translations, definitions);
    });
    return matched.slice().sort((left, right) => compareElements(left, right, this.sort()));
  });
  readonly countLabel = computed(() => {
    const count = this.visible().length;
    return count === 1 ? '1 element' : `${count} elements`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (this.filtersOpen() || this.aiSettingsOpen()) this.unlockScroll();
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.load(params.get('code') ?? '');
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('element')?.trim() ?? '';
      this.elementId.set(id);
      if (!id) this.trail.set([]);
      else if (this.trail().at(-1) !== id) this.trail.set([id]);
      this.reconcileOpen();
    });
  }

  @HostListener('document:click')
  closeSortFromDocument(): void {
    this.sortOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeMenusOnEscape(): void {
    if (this.aiSettingsOpen()) {
      this.closeAiSettings();
      return;
    }
    if (this.filtersOpen()) {
      this.closeFilters();
      return;
    }
    this.sortOpen.set(false);
  }

  openElement(id: string): void {
    if (!id) return;
    this.trail.set([id]);
    this.writeElement(id, false);
  }

  visitElement(id: string): void {
    if (!id || id === this.elementId()) return;
    this.trail.update((trail) => [...trail, id]);
    this.writeElement(id, true);
  }

  backElement(): void {
    const trail = this.trail();
    if (trail.length < 2) return;
    const next = trail.slice(0, -1);
    this.trail.set(next);
    this.writeElement(next[next.length - 1] ?? '', true);
  }

  async addFromSelection(title: string): Promise<void> {
    const name = title.replace(/\s+/g, ' ').trim();
    const code = this.code();
    if (!name || !code) return;
    const created = await addElement(code, name);
    this.elements.set(await readElements(code));
    if (created.id === this.elementId()) return;
    this.visitElement(created.id);
  }

  async addPrepared(
    prepared: {
      title: string;
      definitions: ElementDefinition[];
      example?: string;
    },
    fromSearch = false,
  ): Promise<void> {
    const name = prepared.title.replace(/\s+/g, ' ').trim();
    const code = this.code();
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
    this.elements.set(await readElements(code));
    if (fromSearch) {
      this.clearSearch();
      this.trail.set([created.id]);
      this.writeElement(created.id, false, true);
      return;
    }
    if (created.id === this.elementId()) return;
    this.visitElement(created.id);
  }

  replaceElement(saved: StoredElement): void {
    this.elements.update((list) => list.map((item) => (item.id === saved.id ? saved : item)));
  }

  async setModePoint(element: StoredElement, index: number): Promise<void> {
    if (index < 0 || index > 2) return;
    const latest = this.elements().find((item) => item.id === element.id) ?? element;
    const saved = await saveElement({
      ...latest,
      modePoints: { ...latest.modePoints, [latest.mode]: modePointsThrough(index) },
    });
    this.replaceElement(saved);
  }

  onElementDeleted(): void {
    const id = this.elementId();
    if (id) this.elements.update((list) => list.filter((item) => item.id !== id));
    this.closeElement();
  }

  closeElement(): void {
    if (!this.elementId()) return;
    this.trail.set([]);
    this.writeElement(null, false);
  }

  private writeElement(id: string | null, replace: boolean, dropSearch = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: dropSearch ? { element: id || null, q: null } : { element: id || null },
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  highlightColor(element: StoredElement): string {
    return resolveHighlightColor(element.highlightColor);
  }

  highlightStyle(element: StoredElement): string {
    return resolveHighlightStyle(element.highlightStyle);
  }

  highlight(text: string): ElementSearchPart[] {
    return elementHighlightParts(displayTitle(text, this.code()), this.search());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onSearch(value: string): void {
    const query = value.slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    this.query.set(query);
    this.lookupError.set('');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const search = elementPrefixSearch(query);
      this.search.set(search);
      if (this.router.url.split('?')[0] !== `/languages/${this.code()}`) return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { q: search.mode === 'prefix' ? search.value : null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 250);
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
    this.writeElement(created.id, false, true);
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
            frequency: sense.frequency,
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
    this.sortOpen.update((open) => !open);
  }

  chooseSort(sort: ElementSort): void {
    this.sortOpen.set(false);
    this.sort.set(this.sort() === sort ? 'none' : sort);
    this.writeBrowse();
  }

  openAiSettings(): void {
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
    if (this.aiSettingsOpen()) return;
    this.aiSettingsOpen.set(true);
    this.lockScroll();
  }

  closeAiSettings(): void {
    if (!this.aiSettingsOpen()) return;
    this.aiSettingsOpen.set(false);
    this.unlockScroll();
  }

  openFilters(event: Event): void {
    event.stopPropagation();
    this.sortOpen.set(false);
    this.expanded.set('translations');
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

  toggleSection(section: 'translations' | 'definitions'): void {
    this.expanded.update((current) => (current === section ? null : section));
  }

  stepMinimum(kind: 'translations' | 'definitions', by: number): void {
    const current = kind === 'translations' ? this.minTranslations() : this.minDefinitions();
    const next = (current ?? 0) + by;
    const value = next < 1 ? null : Math.min(next, 99);
    if (kind === 'translations') this.minTranslations.set(value);
    else this.minDefinitions.set(value);
    this.writeBrowse();
  }

  clearMinimum(kind: 'translations' | 'definitions'): void {
    if (kind === 'translations') this.minTranslations.set(null);
    else this.minDefinitions.set(null);
    this.writeBrowse();
  }

  clearFilters(): void {
    this.minTranslations.set(null);
    this.minDefinitions.set(null);
    this.writeBrowse();
  }

  private async load(language: string): Promise<void> {
    const seq = ++this.loadId;
    const code = language.trim().toLowerCase();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const params = this.route.snapshot.queryParamMap;
    const restored = (params.get('q') ?? '').slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    this.query.set(restored);
    this.search.set(elementPrefixSearch(restored));
    this.sort.set(parseElementSort(params.get('sort')));
    this.minTranslations.set(parseElementMinimum(params.get('translations')));
    this.minDefinitions.set(parseElementMinimum(params.get('definitions')));
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
    if (this.aiSettingsOpen()) this.closeAiSettings();
    this.code.set(code);
    this.name.set(languageDisplayName(code));
    this.ready.set(false);
    const elements = await readElements(code);
    if (seq !== this.loadId) return;
    this.elements.set(elements);
    this.ready.set(true);
    this.reconcileOpen();
  }

  private writeBrowse(): void {
    if (this.router.url.split('?')[0] !== `/languages/${this.code()}`) return;
    const sort = this.sort();
    const translations = this.minTranslations();
    const definitions = this.minDefinitions();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sort: sort === DEFAULT_ELEMENT_SORT ? null : sort,
        translations: translations == null ? null : String(translations),
        definitions: definitions == null ? null : String(definitions),
        has: null,
        hide: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private lockScroll(): void {
    this.scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  private unlockScroll(): void {
    document.body.style.overflow = this.scrollLock;
    this.scrollLock = '';
  }

  private reconcileOpen(): void {
    const id = this.elementId();
    if (!this.ready() || !id) return;
    if (this.elements().some((element) => element.id === id)) return;
    this.closeElement();
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
