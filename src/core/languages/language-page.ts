import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, CanActivateFn, Router, RouterLink } from '@angular/router';
import { ElementModal } from '../elements/element-modal';
import {
  addElement,
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesPrefix,
  elementPrefixSearch,
  languageDisplayName,
  readElements,
  readLanguages,
  type ElementSearch,
  type ElementSearchPart,
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
        @if (ready()) {
          <button type="button" class="plus" aria-label="Add an element" (click)="openAdd()">
            +
          </button>
        }
      </header>

      <section class="toolbar" aria-label="Search">
        <form class="search-bar" (submit)="lookup($event)">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
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
      </section>

      @if (!ready()) {
        <ul class="elements" aria-hidden="true">
          @for (item of skeletons; track item) {
            <li class="element skeleton">
              <span class="bone bone-title"></span>
              <span class="bone bone-meta"></span>
            </li>
          }
        </ul>
      } @else if (visible().length) {
        <ul class="elements">
          @for (element of visible(); track element.id) {
            <li>
              <button type="button" class="element" (click)="openElement(element.id)">
                <span class="title">
                  @for (part of highlight(element.title); track $index) {
                    @if (part.hit) {
                      <mark class="hit">{{ part.text }}</mark>
                    } @else {
                      <span>{{ part.text }}</span>
                    }
                  }
                </span>
                @if (preview(element); as line) {
                  <span class="meta">{{ line }}</span>
                }
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

      @if (opened(); as element) {
        <app-element-modal [element]="element" (closed)="closeElement()" />
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

    .toolbar {
      margin: 0;
    }

    .search-bar {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
      height: 2.4rem;
      min-height: 2.4rem;
      padding: 0.2rem 0.2rem 0.2rem 0.15rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.15s ease;
    }

    .search-bar:focus-within {
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .search-icon {
      display: inline-flex;
      flex-shrink: 0;
      margin-left: 0.4rem;
      color: var(--text-muted);
    }

    .search-icon svg,
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

    .search-bar:focus-within .search-icon {
      color: var(--accent-text);
    }

    .entry-input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      padding: 0.32rem 0.2rem;
      border-radius: var(--radius);
      font-size: 0.9rem;
      outline: none;
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
      min-height: 5.35rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.85rem 1rem;
      border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-left: 3px solid color-mix(in srgb, var(--accent-rgb) 70%, transparent);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--bg) 72%, var(--surface));
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
    }

    .meta {
      overflow: hidden;
      color: var(--text-muted);
      font-size: 0.875rem;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .bone-meta {
      width: 34%;
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
  `,
})
export class LanguagePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly adder = viewChild<ElementRef<HTMLDialogElement>>('adder');
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('title');
  private loadId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly maxSearchLength = ELEMENT_SEARCH_MAX_LENGTH;
  readonly skeletons = ELEMENT_SKELETONS;
  readonly code = signal('');
  readonly name = signal('');
  readonly ready = signal(false);
  readonly elements = signal<StoredElement[]>([]);
  readonly query = signal('');
  readonly search = signal<ElementSearch>({ mode: 'browse', value: '' });
  readonly elementId = signal('');
  readonly draft = signal('');
  readonly opened = computed(() => {
    const id = this.elementId();
    if (!id) return null;
    return this.elements().find((element) => element.id === id) ?? null;
  });
  readonly visible = computed(() => {
    const search = this.search();
    const elements = this.elements();
    if (search.mode === 'browse') return elements;
    return elements.filter((element) => elementMatchesPrefix(element, search.value));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.load(params.get('code') ?? '');
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.elementId.set(params.get('element')?.trim() ?? '');
      this.reconcileOpen();
    });
  }

  openElement(id: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { element: id },
      queryParamsHandling: 'merge',
    });
  }

  closeElement(): void {
    if (!this.elementId()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { element: null },
      queryParamsHandling: 'merge',
    });
  }

  highlight(text: string): ElementSearchPart[] {
    return elementHighlightParts(text, this.search());
  }

  preview(element: StoredElement): string {
    return element.definitions.find((definition) => definition.text)?.text ?? '';
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
    await addElement(code, title);
    this.closeAdd();
    this.elements.set(await readElements(code));
  }

  private async load(language: string): Promise<void> {
    const seq = ++this.loadId;
    const code = language.trim().toLowerCase();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const restored = (this.route.snapshot.queryParamMap.get('q') ?? '').slice(
      0,
      ELEMENT_SEARCH_MAX_LENGTH,
    );
    this.query.set(restored);
    this.search.set(elementPrefixSearch(restored));
    this.code.set(code);
    this.name.set(languageDisplayName(code));
    this.ready.set(false);
    const elements = await readElements(code);
    if (seq !== this.loadId) return;
    this.elements.set(elements);
    this.ready.set(true);
    this.reconcileOpen();
  }

  private reconcileOpen(): void {
    const id = this.elementId();
    if (!this.ready() || !id) return;
    if (this.elements().some((element) => element.id === id)) return;
    this.closeElement();
  }
}
