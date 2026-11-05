import { Component, computed, input, output, signal } from '@angular/core';
import {
  addElement,
  displayTitle,
  formMatchesTerm,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
  type StoredElement,
} from 'collection';
import {
  MAX_DISCOVER_INSTRUCTION,
  MAX_METADATA_FIELD_KEY,
  discoverElements,
  readStoredAiCredentials,
} from 'ai';

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
  imports: [],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Discover"
      (click)="onBackdrop($event)"
    >
      <div class="panel" (click)="$event.stopPropagation()">
        <header class="head">
          <div>
            <h2>Discover</h2>
            <p>Titles to add. Metadata and a note narrow the batch.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div class="body">
          <label class="note">
            <span>Instruction</span>
            <textarea
              rows="3"
              [attr.maxlength]="instructionMax"
              placeholder="Argentine expressions"
              aria-label="Instruction"
              [value]="instruction()"
              (input)="instruction.set(fieldValue($event))"
            ></textarea>
          </label>

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
                      [disabled]="valueCount(section.id) === 0"
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
                      [value]="draft(section.id).key"
                      (input)="setDraft(section.id, 'key', $event)"
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      aria-label="Metadata value"
                      [attr.maxlength]="valueMax"
                      [value]="draft(section.id).value"
                      (input)="setDraft(section.id, 'value', $event)"
                    />
                    <button type="submit" [disabled]="!canAdd(section.id)">Add</button>
                  </form>
                </div>
              }
            </section>
          }

          @if (error()) {
            <p class="error">{{ error() }}</p>
          } @else if (notice()) {
            <p class="notice">{{ notice() }}</p>
          }

          @if (results().length) {
            <div class="filter-row" role="group" aria-label="Results">
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
            @if (visibleResults().length) {
              <div class="tile-grid">
                @for (row of visibleResults(); track row.title) {
                  @if (collectedId(row.title); as id) {
                    <button
                      type="button"
                      class="tile collected"
                      [attr.aria-label]="'Open ' + label(row.title)"
                      (click)="open.emit(id)"
                    >
                      <span class="tile-title">{{ label(row.title) }}</span>
                      <span class="tile-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    </button>
                  } @else {
                    <article class="tile">
                      <span class="tile-title">{{ label(row.title) }}</span>
                      <button
                        type="button"
                        class="tile-add"
                        aria-label="Add"
                        title="Add"
                        [disabled]="adding()"
                        (click)="addTitle(row.title)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                      </button>
                    </article>
                  }
                }
              </div>
            } @else {
              <p class="notice">{{ emptyFilterMessage() }}</p>
            }
          }
        </div>

        <footer class="foot">
          @if (results().length) {
            <button
              type="button"
              class="link-btn"
              [disabled]="busy() || adding() || newCount() === 0"
              (click)="addAllNew()"
            >
              Add all new
            </button>
          }
          <button
            type="button"
            class="discover-btn"
            [disabled]="busy() || adding()"
            (click)="discover()"
          >
            {{ busy() ? 'Discovering…' : results().length ? 'More' : 'Discover' }}
          </button>
        </footer>
      </div>
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
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }

    .head,
    .foot {
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
      overflow: auto;
      padding: 0 1.15rem 1.15rem;
    }

    .note {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .note span,
    .key-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    textarea,
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

    textarea {
      min-height: 4.5rem;
      resize: vertical;
    }

    textarea:focus,
    .constraint input:focus {
      outline: none;
      border-color: rgba(var(--accent-rgb), 0.55);
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

    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
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

    .tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(calc((100% - 0.5rem) / 2), 11rem), 1fr));
      gap: 0.5rem;
    }

    .tile {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      height: 4.6rem;
      margin: 0;
      padding: 0.5rem 0.7rem;
      border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-left: 3px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      color: var(--text-muted);
      text-align: left;
    }

    .tile.collected {
      width: 100%;
      cursor: pointer;
      color: var(--text);
      font: inherit;
      background: color-mix(in srgb, var(--accent) 22%, var(--surface));
      border-color: color-mix(in srgb, var(--accent) 52%, transparent);
      border-left-color: var(--accent);
    }

    .tile.collected:hover {
      background: color-mix(in srgb, var(--accent) 30%, var(--surface));
    }

    .tile-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font-size: 1.05rem;
      font-weight: 650;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tile.collected .tile-title {
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
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

    .foot {
      align-items: center;
      justify-content: flex-end;
      gap: 0.35rem;
      padding: 0.85rem 1.15rem 1.15rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    }

    .discover-btn {
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font-size: 0.88rem;
      font-weight: 700;
      padding: 0.65rem 1.25rem;
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
        max-height: calc(100dvh - 1.3rem);
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }

      .constraint {
        flex-wrap: wrap;
      }
    }
  `,
})
export class DiscoverModal {
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
  readonly expanded = signal<DiscoverKind | null>(null);
  readonly definitionMeta = signal<ElementMetadataVariability>({});
  readonly exampleMeta = signal<ElementMetadataVariability>({});
  readonly formMeta = signal<ElementMetadataVariability>({});
  readonly drafts = signal<Record<DiscoverKind, DiscoverDraft>>({
    definition: { ...EMPTY_DRAFT },
    example: { ...EMPTY_DRAFT },
    form: { ...EMPTY_DRAFT },
  });
  readonly results = signal<{ title: string }[]>([]);
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
  readonly newCount = computed(
    () => this.results().filter((row) => !this.matchIds().has(row.title)).length,
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

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  fieldValue(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
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
    this.setMeta(kind, {});
  }

  draft(kind: DiscoverKind): DiscoverDraft {
    return this.drafts()[kind];
  }

  setDraft(kind: DiscoverKind, field: keyof DiscoverDraft, event: Event): void {
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
    if (!this.canAdd(kind)) return;
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

  collectedId(title: string): string {
    return this.matchIds().get(title) ?? '';
  }

  emptyFilterMessage(): string {
    return this.resultFilter() === 'collected'
      ? 'None of these are in the collection yet.'
      : 'All of these are already in the collection.';
  }

  async discover(): Promise<void> {
    if (this.busy() || this.adding()) return;
    this.notice.set('');
    await this.load();
  }

  async addTitle(title: string): Promise<void> {
    if (this.adding() || this.collectedId(title)) return;
    const language = this.language().trim();
    if (!language) return;
    this.adding.set(true);
    this.error.set('');
    try {
      await addElement(language, title);
      this.added.emit();
    } catch {
      this.error.set('Could not add that element.');
    } finally {
      this.adding.set(false);
    }
  }

  async addAllNew(): Promise<void> {
    if (this.adding() || this.busy() || this.newCount() === 0) return;
    const language = this.language().trim();
    const titles = this.results()
      .map((row) => row.title)
      .filter((title) => !this.collectedId(title));
    if (!language || titles.length === 0) return;
    this.adding.set(true);
    this.error.set('');
    try {
      for (const title of titles) await addElement(language, title);
    } catch {
      this.error.set('Could not add those elements.');
    } finally {
      this.added.emit();
      this.adding.set(false);
    }
  }

  private async load(): Promise<void> {
    const language = this.language().trim();
    if (!language || this.busy()) return;
    const job = ++this.job;
    this.busy.set(true);
    this.error.set('');
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      this.busy.set(false);
      return;
    }
    try {
      const titles = await discoverElements({
        language,
        instruction: this.instruction(),
        metadata: {
          definition: this.definitionMeta(),
          example: this.exampleMeta(),
          form: this.formMeta(),
        },
        excludeTitles: this.excludeTitles(),
      });
      if (job !== this.job) return;
      const fresh = titles.filter((title) => !this.shown(title));
      if (!fresh.length) {
        this.notice.set(
          this.results().length ? 'Nothing new in that batch.' : 'Nothing new to add.',
        );
        return;
      }
      this.notice.set('');
      this.results.update((rows) => [...rows, ...fresh.map((title) => ({ title }))]);
    } catch {
      if (job !== this.job) return;
      this.error.set('Could not discover elements.');
    } finally {
      if (job === this.job) this.busy.set(false);
    }
  }

  private excludeTitles(): string[] {
    const collected = [...this.elements()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((element) => element.title);
    return [...this.results().map((row) => row.title), ...collected];
  }

  private shown(title: string): boolean {
    return this.results().some((row) => sameTitle(row.title, title));
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
