import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, CanActivateFn, Router, RouterLink } from '@angular/router';
import { ElementModal } from '../elements/element-modal';
import {
  addElement,
  compareElements,
  DEFAULT_ELEMENT_SORT,
  ELEMENT_FACETS,
  ELEMENT_SEARCH_MAX_LENGTH,
  comfortColor,
  elementHighlightParts,
  elementMatchesFacets,
  elementMatchesPrefix,
  elementPrefixSearch,
  languageDisplayName,
  resolveHighlightColor,
  resolveHighlightStyle,
  parseElementFacets,
  parseElementSort,
  readElements,
  readLanguages,
  type ElementFacet,
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
  imports: [RouterLink, ElementModal],
  template: `
    <main>
      <header>
        <a class="back" routerLink="/" [attr.aria-label]="'Back to languages'">
          <span class="gem gem-mark" aria-hidden="true"></span>
          <span>{{ name() }}</span>
        </a>
        <div class="header-actions">
          <a class="settings" routerLink="/settings" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </a>
          @if (ready()) {
            <button type="button" class="plus" aria-label="Add an element" (click)="openAdd()">
              +
            </button>
          }
        </div>
      </header>

      <section class="entries-toolbar" aria-label="Search">
        <form class="search-bar" (submit)="lookup($event)">
          <input
            class="entry-input"
            type="search"
            name="entry"
            [value]="query()"
            [attr.maxlength]="maxSearchLength"
            (input)="onSearch(inputValue($event))"
            placeholder="Search lemmas or forms…"
            aria-label="Search lemmas or forms"
          />
          @if (query()) {
            <div class="search-actions">
              <button
                type="button"
                class="search-clear"
                aria-label="Clear search"
                (click)="onSearch('')"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              @if (query().trim()) {
                <button type="submit" class="search-add" aria-label="Add entry">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                </button>
              }
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
              <button
                type="button"
                class="element"
                [style.--highlight-color]="highlightColor(element)"
                [style.--highlight-style]="highlightStyle(element)"
                (click)="openElement(element.id)"
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
                <span class="score" [style.color]="comfortColor(element.score)">
                  {{ element.score }} / 10
                </span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ elements().length ? 'No matching elements.' : 'No elements yet.' }}</p>
      }

      <dialog #adder (click)="closeOnBackdrop($event)" (close)="draft.set('')">
        <form (submit)="add($event)">
          <div class="modal-head">
            <h2>Add an element</h2>
            <button type="button" class="close" aria-label="Close" (click)="closeAdd()">×</button>
          </div>
          <label for="element-title">Title</label>
          <input
            #title
            id="element-title"
            [value]="draft()"
            (input)="draft.set(inputValue($event))"
            autocomplete="off"
            required
          />
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
      </dialog>

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
                <p class="filter-subtitle">Refine your collection by what each element has.</p>
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

              <section class="filter-section" [class.expanded]="expanded() === 'include'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'include'"
                  (click)="toggleSection('include')"
                >
                  <span class="section-title">
                    Include
                    @if (include().length) {
                      <span class="section-count">{{ include().length }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'include') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="include().length === 0"
                        (click)="clearFacet('include')"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">Show elements that have at least one of these.</p>
                    <div class="facet-options" role="group" aria-label="Include">
                      @for (facet of facets; track facet.value) {
                        <button
                          type="button"
                          class="facet-chip"
                          [class.selected]="hasFacet('include', facet.value)"
                          [attr.aria-pressed]="hasFacet('include', facet.value)"
                          (click)="toggleFacet('include', facet.value)"
                        >
                          {{ facet.label }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="filter-section" [class.expanded]="expanded() === 'exclude'">
                <button
                  type="button"
                  class="section-header"
                  [attr.aria-expanded]="expanded() === 'exclude'"
                  (click)="toggleSection('exclude')"
                >
                  <span class="section-title">
                    Exclude
                    @if (exclude().length) {
                      <span class="section-count">{{ exclude().length }}</span>
                    }
                  </span>
                  <svg class="section-chevron" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                @if (expanded() === 'exclude') {
                  <div class="section-body">
                    <div class="section-actions">
                      <button
                        type="button"
                        class="link-btn"
                        [disabled]="exclude().length === 0"
                        (click)="clearFacet('exclude')"
                      >
                        Clear
                      </button>
                    </div>
                    <p class="section-hint">Hide elements that have any of these.</p>
                    <div class="facet-options" role="group" aria-label="Exclude">
                      @for (facet of facets; track facet.value) {
                        <button
                          type="button"
                          class="facet-chip exclude"
                          [class.selected]="hasFacet('exclude', facet.value)"
                          [attr.aria-pressed]="hasFacet('exclude', facet.value)"
                          (click)="toggleFacet('exclude', facet.value)"
                        >
                          {{ facet.label }}
                        </button>
                      }
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
          (closed)="closeElement()"
          (changed)="replaceElement($event)"
          (deleted)="onElementDeleted()"
          (visit)="openElement($event)"
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
      justify-content: space-between;
      gap: 0.75rem;
    }

    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
      color: var(--text);
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      text-decoration: none;
    }

    .gem-mark {
      --gem-size: 1.35rem;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }

    .settings {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 999px;
      color: var(--text-muted);
      text-decoration: none;
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

    .plus,
    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      cursor: pointer;
    }

    .plus {
      width: 2.25rem;
      height: 2.25rem;
      flex: none;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font-size: 1.45rem;
      line-height: 1;
    }

    .plus:hover {
      background: var(--accent-hover);
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
      appearance: none;
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

    .search-add,
    .search-clear {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 999px;
      padding: 0;
      line-height: 0;
      cursor: pointer;
    }

    .search-add {
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
    }

    .search-add:hover {
      background: rgba(var(--accent-rgb), 0.28);
    }

    .search-clear {
      background: transparent;
      color: var(--text-muted);
    }

    .search-clear:hover {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
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
      flex-direction: column;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.85rem 1rem;
      border: 1px solid color-mix(in srgb, var(--highlight-color, var(--accent)) 28%, transparent);
      border-left: 3px solid var(--highlight-color, var(--accent));
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--highlight-color, var(--accent)) 14%, var(--surface));
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    button.element:hover {
      background: var(--surface);
    }

    .title {
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      text-decoration-line: underline;
      text-decoration-style: var(--highlight-style, solid);
      text-decoration-color: var(--highlight-color, #6c63ff);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
    }

    .score {
      font-size: 0.78rem;
      font-weight: 650;
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

    dialog {
      width: min(100% - 2rem, 24rem);
      margin: auto;
      padding: 1.15rem 1.15rem 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    }

    dialog::backdrop {
      background: rgba(8, 10, 16, 0.72);
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }

    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
    }

    .close {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
    }

    label {
      font-size: 0.8125rem;
      font-weight: 650;
      color: var(--muted);
    }

    dialog input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.7rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
    }

    form .btn {
      align-self: flex-end;
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

    .facet-options {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .facet-chip {
      border: 0;
      border-radius: 0.65rem;
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      color: var(--text-muted);
      padding: 0.4rem 0.65rem;
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .facet-chip:hover {
      color: var(--text);
      background: rgba(127, 127, 127, 0.1);
    }

    .facet-chip.selected {
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.35);
    }

    .facet-chip.exclude.selected {
      background: color-mix(in srgb, #c45c5c 18%, transparent);
      color: color-mix(in srgb, #c45c5c 80%, var(--text));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #c45c5c 45%, transparent);
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
  private readonly adder = viewChild<ElementRef<HTMLDialogElement>>('adder');
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('title');
  private loadId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollLock = '';

  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly skeletons = ELEMENT_SKELETONS;
  readonly sortOptions: { value: ElementSort; label: string }[] = [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'created-desc', label: 'Most recent' },
    { value: 'created-asc', label: 'Least recent' },
    { value: 'definitions-desc', label: 'Most definitions' },
    { value: 'examples-desc', label: 'Most examples' },
  ];
  readonly facets: { value: ElementFacet; label: string }[] = [
    { value: 'definitions', label: 'Definitions' },
    { value: 'forms', label: 'Forms' },
    { value: 'examples', label: 'Examples' },
  ];
  readonly code = signal('');
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly sort = signal<ElementSort>(DEFAULT_ELEMENT_SORT);
  readonly include = signal<ElementFacet[]>([]);
  readonly exclude = signal<ElementFacet[]>([]);
  readonly sortOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly expanded = signal<'include' | 'exclude' | null>('include');
  readonly elementId = signal('');
  readonly draft = signal('');
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly filterCount = computed(() => this.include().length + this.exclude().length);
  readonly sortActive = computed(() => {
    const sort = this.sort();
    return sort !== DEFAULT_ELEMENT_SORT && sort !== 'none';
  });
  readonly visible = computed(() => {
    const search = this.search();
    const include = this.include();
    const exclude = this.exclude();
    const matched = this.elements().filter((element) => {
      if (search.mode === 'prefix' && !elementMatchesPrefix(element, search.value)) return false;
      return elementMatchesFacets(element, include, exclude);
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
      if (this.filtersOpen()) this.unlockScroll();
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.load(params.get('code') ?? '');
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.elementId.set(params.get('element')?.trim() ?? '');
      this.reconcileOpen();
    });
  }

  @HostListener('document:click')
  closeSortFromDocument(): void {
    this.sortOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeMenusOnEscape(): void {
    if (this.filtersOpen()) {
      this.closeFilters();
      return;
    }
    this.sortOpen.set(false);
  }

  openElement(id: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { element: id },
      queryParamsHandling: 'merge',
    });
  }

  replaceElement(saved: StoredElement): void {
    this.elements.update((list) => list.map((item) => (item.id === saved.id ? saved : item)));
  }

  onElementDeleted(): void {
    const id = this.elementId();
    if (id) this.elements.update((list) => list.filter((item) => item.id !== id));
    this.closeElement();
  }

  closeElement(): void {
    if (!this.elementId()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { element: null },
      queryParamsHandling: 'merge',
    });
  }

  readonly comfortColor = comfortColor;

  highlightColor(element: StoredElement): string {
    return resolveHighlightColor(element.highlightColor, element.score);
  }

  highlightStyle(element: StoredElement): string {
    return resolveHighlightStyle(element.highlightStyle);
  }

  highlight(text: string): ElementSearchPart[] {
    return elementHighlightParts(text, this.search());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onSearch(value: string): void {
    const query = value.slice(0, ELEMENT_SEARCH_MAX_LENGTH);
    this.query.set(query);
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
    if (!title || !code) return;
    const created = await addElement(code, title);
    this.elements.set(await readElements(code));
    this.openElement(created.id);
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

  openFilters(event: Event): void {
    event.stopPropagation();
    this.sortOpen.set(false);
    this.expanded.set('include');
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

  toggleSection(section: 'include' | 'exclude'): void {
    this.expanded.update((current) => (current === section ? null : section));
  }

  hasFacet(kind: 'include' | 'exclude', facet: ElementFacet): boolean {
    return (kind === 'include' ? this.include() : this.exclude()).includes(facet);
  }

  toggleFacet(kind: 'include' | 'exclude', facet: ElementFacet): void {
    const include = new Set(this.include());
    const exclude = new Set(this.exclude());
    const target = kind === 'include' ? include : exclude;
    const other = kind === 'include' ? exclude : include;
    if (target.has(facet)) target.delete(facet);
    else {
      target.add(facet);
      other.delete(facet);
    }
    this.include.set(ELEMENT_FACETS.filter((item) => include.has(item)));
    this.exclude.set(ELEMENT_FACETS.filter((item) => exclude.has(item)));
    this.writeBrowse();
  }

  clearFacet(kind: 'include' | 'exclude'): void {
    if (kind === 'include') this.include.set([]);
    else this.exclude.set([]);
    this.writeBrowse();
  }

  clearFilters(): void {
    this.include.set([]);
    this.exclude.set([]);
    this.writeBrowse();
  }

  openAdd(): void {
    this.draft.set('');
    this.adder()?.nativeElement.showModal();
    queueMicrotask(() => this.titleInput()?.nativeElement.focus());
  }

  closeAdd(): void {
    this.adder()?.nativeElement.close();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeAdd();
  }

  async add(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.draft().trim();
    const code = this.code();
    if (!title || !code) return;
    const created = await addElement(code, title);
    this.closeAdd();
    this.elements.set(await readElements(code));
    this.openElement(created.id);
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
    this.include.set(parseElementFacets(params.get('has')));
    this.exclude.set(parseElementFacets(params.get('hide')));
    this.sortOpen.set(false);
    if (this.filtersOpen()) this.closeFilters();
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
    const include = this.include();
    const exclude = this.exclude();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sort: sort === DEFAULT_ELEMENT_SORT ? null : sort,
        has: include.length ? include.join(',') : null,
        hide: exclude.length ? exclude.join(',') : null,
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
