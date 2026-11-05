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
  untracked,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { generateElementFromSelection, generateExamples } from 'ai';
import {
  definitionFrequencyLabel,
  displayTitle,
  elementModeLabel,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  parsePassage,
  saveElement,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementMetadata,
  type HighlightStyle,
  type StoredElement,
} from 'collection';
import { FrequencyGem } from './frequency-gem';
import { ModeIcon } from './mode-icon';
import { scoreColor } from './mode-palette';
import { ModeProgress } from './mode-progress';
import { Reveal } from './reveal';
import { readStepGoal } from './step-goal';

const EQUIVALENT_MAX = 200;

type PassageSelection = {
  text: string;
  definitionIndex: number;
  exampleIndex: number | null;
};

type PreparedElement = {
  title: string;
  definitions: ElementDefinition[];
  example: string;
};

type HighlightSource = {
  id: string;
  title: string;
  forms: string[];
  color: string;
  style: HighlightStyle;
};

/** One selectable passage. Translations are already stripped by the caller. */
@Component({
  selector: 'app-extract-passage',
  template: `
    <p
      class="passage sense-selectable"
      [attr.data-definition-index]="definitionIndex()"
      [attr.data-example-index]="exampleIndex()"
    >
      @for (part of parts(); track $index) {
        @if (part.matches.length > 1) {
          <button
            type="button"
            class="linguagem-highlighted"
            [style.--highlight-color]="part.color"
            [textContent]="part.text"
            (click)="onCollide($event, part.matches)"
          ></button>
        } @else if (part.matches.length === 1 && !part.current) {
          <button
            type="button"
            class="linguagem-highlighted"
            [style.--highlight-color]="part.color"
            [textContent]="part.text"
            (click)="onVisit($event, part.matches[0].elementId)"
          ></button>
        } @else if (part.current) {
          <span
            class="linguagem-highlighted linguagem-highlighted--current"
            [style.--highlight-color]="part.color"
            [textContent]="part.text"
          ></span>
        } @else {
          <span [textContent]="part.text"></span>
        }
      }
    </p>
  `,
  styles: `
    :host {
      display: block;
    }

    .passage {
      margin: 0;
      white-space: pre-wrap;
    }

    .linguagem-highlighted {
      background: transparent;
      color: inherit;
      border-bottom: none;
      text-decoration-line: underline;
      text-decoration-style: solid;
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
  `,
})
class ExtractPassage {
  readonly definitionIndex = input.required<number>();
  readonly exampleIndex = input<number | null>(null);
  readonly parts = input.required<DefinitionHighlightPart[]>();
  readonly visit = output<string>();
  readonly collide = output<DefinitionHighlightMatch[]>();

  onVisit(event: MouseEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.visit.emit(id);
  }

  onCollide(event: MouseEvent, matches: DefinitionHighlightMatch[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.collide.emit(matches);
  }
}

/** Extract: write one equivalent per definition. Definition translations can be revealed. */
@Component({
  selector: 'app-extract-game',
  imports: [ExtractPassage, FrequencyGem, ModeIcon, ModeProgress, NgTemplateOutlet, Reveal],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Extract, ' + shownTitle()"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-row">
            <div class="mode-mark">
              <app-mode-icon [mode]="1" />
              <span>{{ modeLabel(1) }}</span>
            </div>
            <app-mode-progress
              [mode]="1"
              [succeeded]="element().modeProgress[1]"
              [goal]="goal()"
              [labeled]="true"
            />
            <button
              #closeButton
              type="button"
              class="close"
              aria-label="Close"
              [disabled]="busy()"
              (click)="closed.emit()"
            >
              ×
            </button>
          </div>
          <h2>{{ shownTitle() }}</h2>
        </header>
        <div class="body">
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          @if (collision(); as matches) {
            <div class="collision" role="menu" aria-label="Matching elements">
              @for (match of matches; track match.elementId) {
                <button type="button" (click)="visitHighlight(match.elementId)">
                  {{ shownTitle(match.title) }}
                </button>
              }
            </div>
          }
          <ol class="definitions">
            @for (definition of element().definitions; track $index; let index = $index) {
              @let passage = parsePassage(definition.text);
              <li class="sense">
                @if (passage.text) {
                  <app-extract-passage
                    [definitionIndex]="index"
                    [parts]="highlightPassage(passage.text)"
                    (visit)="visitHighlight($event)"
                    (collide)="collision.set($event)"
                  />
                }
                @if (passage.translations.length) {
                  <ul class="equivalents">
                    @for (translation of passage.translations; track $index) {
                      <li>
                        <app-reveal
                          [text]="translation.text"
                          [language]="element().language"
                        />
                      </li>
                    }
                  </ul>
                }
                @if (passagePick(index, null); as pick) {
                  <ng-container *ngTemplateOutlet="lookup; context: { pick: pick }" />
                }
                <ul class="sense-meta">
                  <li class="sense-frequency">
                    <app-frequency-gem [frequency]="definition.frequency" />
                    {{ frequencyLabel(definition.frequency) }}
                  </li>
                  @for (entry of entries(definition.metadata); track entry.key) {
                    <li>
                      <span class="sense-meta-key">{{ label(entry.key) }}</span>
                      {{ label(entry.value) }}
                    </li>
                  }
                </ul>
                <label class="field-label" [attr.for]="'extract-equivalent-' + index">
                  Equivalent
                </label>
                <input
                  [id]="'extract-equivalent-' + index"
                  type="text"
                  autocomplete="off"
                  [value]="draftAt(index)"
                  [attr.maxlength]="equivalentMax"
                  [disabled]="busy()"
                  placeholder="Write the equivalent"
                  (input)="onDraft(index, $event)"
                />
                <button
                  type="button"
                  class="btn btn-secondary example-btn"
                  [disabled]="aiBusy() || !passage.text"
                  [attr.aria-busy]="askingExample() === index ? true : null"
                  (click)="generateExample(index)"
                >
                  Example
                </button>
                @if (exampleList(index).length) {
                  <ul class="examples">
                    @for (sentence of exampleList(index); track $index; let exampleIndex = $index) {
                      <li>
                        <div class="example-quote">
                          <app-extract-passage
                            [definitionIndex]="index"
                            [exampleIndex]="exampleIndex"
                            [parts]="highlightPassage(sentence)"
                            (visit)="visitHighlight($event)"
                            (collide)="collision.set($event)"
                          />
                        </div>
                        @if (passagePick(index, exampleIndex); as pick) {
                          <ng-container *ngTemplateOutlet="lookup; context: { pick: pick }" />
                        }
                      </li>
                    }
                  </ul>
                }
                @if (formTexts(definition.forms); as forms) {
                  @if (forms.length) {
                    <section class="group">
                      <button
                        type="button"
                        class="section-title forms-fold"
                        [attr.aria-expanded]="formsOpen(index)"
                        (click)="toggleForms(index)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
                          />
                          <path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5" />
                          <path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5" />
                        </svg>
                        Forms
                        <svg
                          class="fold-chevron"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          [class.open]="formsOpen(index)"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      @if (formsOpen(index)) {
                        <ul class="forms">
                          @for (form of forms; track form) {
                            <li>
                              <span class="form-chip">{{ form }}</span>
                            </li>
                          }
                        </ul>
                      }
                    </section>
                  }
                }
              </li>
            }
          </ol>
        </div>
        <footer>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="!canAddPoint()"
            (click)="addPoint()"
          >
            Add a point
          </button>
        </footer>
      </div>
    </div>
    <ng-template #lookup let-pick="pick">
      <span class="lookup-actions">
        <button
          type="button"
          class="lookup-chip"
          aria-label="Add element"
          [disabled]="aiBusy()"
          (pointerdown)="confirmPassagePick($event, pick.text)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add
        </button>
        <button
          type="button"
          class="lookup-chip"
          aria-label="Add element with AI"
          [disabled]="aiBusy()"
          [attr.aria-busy]="addingSelection() ? true : null"
          (pointerdown)="confirmPassagePick($event, pick.text, true)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
            />
          </svg>
          Ask AI
        </button>
      </span>
    </ng-template>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 36;
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
    footer {
      display: flex;
      flex: none;
      gap: 0.7rem;
      padding: 0.9rem 1.15rem;
    }

    header {
      flex-direction: column;
      align-items: stretch;
      border-bottom: 1px solid var(--border);
    }

    footer {
      justify-content: flex-end;
      border-top: 1px solid var(--border);
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .mode-mark {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      margin-right: auto;
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 750;
    }

    .mode-mark app-mode-icon {
      width: 1.7rem;
      height: 1.7rem;
      flex: none;
    }

    h2,
    p {
      margin: 0;
    }

    h2 {
      min-width: 0;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
    }

    .close:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .close:disabled,
    .example-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
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

    .error {
      color: var(--danger);
      font-size: 0.82rem;
    }

    .definitions,
    .examples,
    .sense-meta {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definitions,
    .sense,
    .examples {
      display: flex;
      flex-direction: column;
    }

    .definitions {
      gap: 0.85rem;
    }

    .sense,
    .examples {
      gap: 0.55rem;
    }

    .sense {
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }

    .sense-meta li {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      height: 1.7rem;
      padding: 0 0.5rem;
      border: 1px solid rgba(139, 144, 165, 0.4);
      border-radius: 0.35rem;
      color: var(--text-muted);
      font-size: 0.72rem;
      line-height: 1;
      white-space: nowrap;
    }

    .sense-frequency {
      gap: 0.28rem;
    }

    .sense-frequency app-frequency-gem {
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
    }

    .sense-meta-key {
      margin-right: 0.35rem;
      font-weight: 600;
    }

    .field-label {
      font-size: 0.78rem;
      font-weight: 650;
      color: var(--text-muted);
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
    }

    input:disabled {
      opacity: 0.45;
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      margin-top: 0.2rem;
      padding-top: 0.85rem;
      border-top: 1px solid rgba(139, 144, 165, 0.28);
    }

    button.section-title {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1;
      text-transform: uppercase;
      cursor: pointer;
    }

    button.forms-fold {
      justify-content: flex-start;
    }

    button.section-title svg {
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

    button.section-title .fold-chevron {
      width: 1rem;
      height: 1rem;
      stroke: currentColor;
    }

    button.section-title .fold-chevron.open {
      transform: rotate(180deg);
    }

    .forms {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .form-chip {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .example-btn {
      align-self: flex-start;
    }

    .example-quote {
      padding: 0.1rem 0 0.1rem 0.85rem;
      border-left: 3px solid rgba(var(--accent-rgb), 0.45);
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .lookup-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
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
      width: 0.9rem;
      height: 0.9rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .lookup-chip:disabled {
      opacity: 0.45;
      cursor: not-allowed;
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
  `,
})
export class ExtractGame {
  readonly element = input.required<StoredElement>();
  readonly collection = input.required<readonly StoredElement[]>();
  /** The element modal is open on top, so this panel ignores Escape and selections. */
  readonly covered = input(false);
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly visit = output<string>();
  readonly addSelection = output<string>();
  readonly addPrepared = output<PreparedElement>();

  readonly modeLabel = elementModeLabel;
  readonly frequencyLabel = definitionFrequencyLabel;
  readonly formTexts = formTexts;
  readonly equivalentMax = EQUIVALENT_MAX;

  readonly drafts = signal<string[]>([]);
  readonly examples = signal<string[][]>([]);
  readonly formsExpanded = signal<boolean[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly askingExample = signal<number | null>(null);
  readonly addingSelection = signal(false);
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly passageSelection = signal<PassageSelection | null>(null);

  readonly goal = computed(() => readStepGoal(this.element().language));
  readonly canAddPoint = computed(() => {
    if (this.aiBusy()) return false;
    const element = this.element();
    const goal = this.goal();
    const progress = Math.min(goal, Math.max(0, element.modeProgress[1] ?? 0));
    if (progress >= goal) return false;
    const drafts = this.drafts();
    return element.definitions.every((_, index) => (drafts[index] ?? '').trim().length > 0);
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private trackedId = '';
  private alive = true;
  private exampleJob = 0;
  private selectionJob = 0;
  private blockPassageSelectionUntil = 0;

  constructor() {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('selectionchange', this.syncPassageSelection);
    document.addEventListener('pointerdown', this.onSelectionPointerDown, true);
    document.addEventListener('pointerup', this.syncPassageSelection, true);
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('selectionchange', this.syncPassageSelection);
      document.removeEventListener('pointerdown', this.onSelectionPointerDown, true);
      document.removeEventListener('pointerup', this.syncPassageSelection, true);
    });
    effect(() => {
      const id = this.element().id;
      const count = this.element().definitions.length;
      untracked(() => this.rememberElement(id, count));
    });
    effect(() => {
      if (!this.covered()) return;
      untracked(() => {
        this.passageSelection.set(null);
        this.collision.set(null);
      });
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.covered() || this.busy()) return;
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (this.covered() || this.busy() || event.target !== event.currentTarget) return;
    this.closed.emit();
  }

  readonly parsePassage = parsePassage;

  shownTitle(title = this.element().title): string {
    return displayTitle(title, this.element().language);
  }

  draftAt(index: number): string {
    return this.drafts()[index] ?? '';
  }

  exampleList(index: number): string[] {
    return this.examples()[index] ?? [];
  }

  aiBusy(): boolean {
    return this.busy() || this.addingSelection() || this.askingExample() !== null;
  }

  onDraft(index: number, event: Event): void {
    this.writeRow(this.drafts, index, (event.target as HTMLInputElement).value, EQUIVALENT_MAX);
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }

  /** First letter of a metadata label, leaving the rest of the wording alone. */
  label(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  formsOpen(index: number): boolean {
    return this.formsExpanded()[index] ?? false;
  }

  toggleForms(index: number): void {
    const next = this.formsExpanded().slice();
    while (next.length <= index) next.push(false);
    next[index] = !next[index];
    this.formsExpanded.set(next);
  }

  highlightPassage(text: string): DefinitionHighlightPart[] {
    const element = this.element();
    const others: HighlightSource[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      others.push({
        id: item.id,
        title: item.title,
        forms: elementFormTexts(item),
        ...appearanceOf(item),
      });
    }
    return highlightDefinitionPassage(
      text,
      {
        id: element.id,
        title: element.title,
        forms: elementFormTexts(element),
        ...appearanceOf(element),
      },
      others,
    );
  }

  visitHighlight(id: string): void {
    this.collision.set(null);
    if (!id || id === this.element().id) return;
    this.visit.emit(id);
  }

  passagePick(definitionIndex: number, exampleIndex: number | null): PassageSelection | null {
    const pick = this.passageSelection();
    if (!pick || pick.definitionIndex !== definitionIndex || pick.exampleIndex !== exampleIndex) {
      return null;
    }
    return pick;
  }

  confirmPassagePick(event: Event, text: string, ai = false): void {
    event.preventDefault();
    event.stopPropagation();
    const title = text.replace(/\s+/g, ' ').trim();
    if (!title || this.aiBusy() || this.covered()) return;
    if (ai) this.addingSelection.set(true);
    this.blockPassageSelectionUntil = Date.now() + 400;
    const selection = window.getSelection();
    if (selection && this.selectionInHost(selection)) selection.removeAllRanges();
    if (!ai) {
      this.passageSelection.set(null);
      this.addSelection.emit(title);
      return;
    }
    void this.askSelectionElement(title, this.passageSelection());
  }

  async generateExample(index: number): Promise<void> {
    if (this.aiBusy()) return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    const job = ++this.exampleJob;
    this.askingExample.set(index);
    this.error.set('');
    try {
      const temporary = this.examples()[index] ?? [];
      const stored = definition.examples.map((item) => parsePassage(item.text).text);
      const examples = await generateExamples({
        language: element.language,
        title: element.title,
        gloss,
        partOfSpeech: definition.metadata['part of speech'],
        existingExamples: [...stored, ...temporary],
        forms: definition.forms.map((form) => form.text),
        exampleWords: [],
      });
      if (!this.alive || job !== this.exampleJob || this.element().id !== element.id) return;
      const sentence = parsePassage(examples[0]?.text ?? '')
        .text.replace(/\s+/g, ' ')
        .trim();
      const key = sentence.toLowerCase();
      const current = this.examples()[index] ?? [];
      if (!sentence || current.some((item) => item.toLowerCase() === key)) {
        this.error.set('No further examples.');
        return;
      }
      const next = this.examples().slice();
      next[index] = [...current, sentence];
      this.examples.set(next);
    } catch {
      if (this.alive && this.element().id === element.id)
        this.error.set('Could not ask for examples.');
    } finally {
      if (this.alive && job === this.exampleJob) this.askingExample.set(null);
    }
  }

  async addPoint(): Promise<void> {
    if (!this.canAddPoint()) return;
    const element = this.element();
    const goal = readStepGoal(element.language);
    const current = Math.min(goal, Math.max(0, element.modeProgress[1] ?? 0));
    if (current >= goal) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({
        ...element,
        modeProgress: { ...element.modeProgress, 1: current + 1 },
      });
      if (!this.alive || this.element().id !== element.id) return;
      this.changed.emit(saved);
      this.closed.emit();
    } catch {
      if (this.alive && this.element().id === element.id)
        this.error.set('Could not save this element.');
    } finally {
      if (this.alive && this.element().id === element.id) this.busy.set(false);
    }
  }

  private async askSelectionElement(title: string, pick: PassageSelection | null): Promise<void> {
    const element = this.element();
    const context = pick ? this.passagePlain(pick) : '';
    const example = pick?.exampleIndex == null ? '' : context;
    const job = ++this.selectionJob;
    this.addingSelection.set(true);
    this.error.set('');
    try {
      const generated = await generateElementFromSelection({
        language: element.language,
        selected: title,
        context,
      });
      if (!this.alive || job !== this.selectionJob || this.element().id !== element.id) return;
      if (!generated) {
        this.error.set('Could not add that element.');
        return;
      }
      this.passageSelection.set(null);
      this.addPrepared.emit({
        title: generated.lemma,
        example,
        definitions: generated.definitions.map((sense, index) => ({
          text: sense.text,
          equivalentId: null,
          forms: selectionForms(generated.lemma, title),
          examples: index === 0 && example ? [{ text: example, metadata: {} }] : [],
          metadata: { ...sense.metadata },
          frequency: sense.frequency,
        })),
      });
    } catch {
      if (this.alive && this.element().id === element.id)
        this.error.set('Could not add that element.');
    } finally {
      if (this.alive && job === this.selectionJob) this.addingSelection.set(false);
    }
  }

  private passagePlain(pick: PassageSelection): string {
    if (pick.exampleIndex == null) {
      return parsePassage(this.element().definitions[pick.definitionIndex]?.text ?? '').text;
    }
    return this.examples()[pick.definitionIndex]?.[pick.exampleIndex] ?? '';
  }

  private rememberElement(id: string, count: number): void {
    if (id !== this.trackedId) {
      this.trackedId = id;
      this.drafts.set(Array.from({ length: count }, () => ''));
      this.examples.set(Array.from({ length: count }, () => []));
      this.formsExpanded.set(Array.from({ length: count }, () => false));
      this.passageSelection.set(null);
      this.collision.set(null);
      this.error.set('');
      this.askingExample.set(null);
      this.addingSelection.set(false);
      return;
    }
    if (this.drafts().length === count) return;
    const drafts = this.drafts();
    const examples = this.examples();
    const formsExpanded = this.formsExpanded();
    this.drafts.set(Array.from({ length: count }, (_, index) => drafts[index] ?? ''));
    this.examples.set(Array.from({ length: count }, (_, index) => examples[index] ?? []));
    this.formsExpanded.set(
      Array.from({ length: count }, (_, index) => formsExpanded[index] ?? false),
    );
  }

  private writeRow(
    rows: WritableSignal<string[]>,
    index: number,
    value: string,
    max: number,
  ): void {
    const next = rows().slice();
    next[index] = value.slice(0, max);
    rows.set(next);
  }

  private readonly syncPassageSelection = (): void => {
    if (this.covered()) {
      if (this.passageSelection()) this.passageSelection.set(null);
      return;
    }
    const selection = window.getSelection();
    if (Date.now() < this.blockPassageSelectionUntil) {
      if (selection && this.selectionInHost(selection)) {
        selection.removeAllRanges();
        if (!this.addingSelection()) this.passageSelection.set(null);
      }
      return;
    }
    if (this.addingSelection()) return;
    this.passageSelection.set(this.readPassageSelection());
  };

  private readonly onSelectionPointerDown = (event: Event): void => {
    if (this.covered()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !this.host.nativeElement.contains(target)) return;
    if (target.closest('.sense-selectable, .lookup-chip')) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (!this.selectionInHost(selection)) return;
    selection.removeAllRanges();
    this.passageSelection.set(null);
  };

  private readPassageSelection(): PassageSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const anchor = node instanceof Element ? node : node.parentElement;
    const passage = anchor?.closest('.sense-selectable');
    if (!passage || !this.host.nativeElement.contains(passage)) return null;
    if (selectionCoversPassage(passage, range)) return null;
    const definitionIndex = Number(passage.getAttribute('data-definition-index'));
    if (!Number.isInteger(definitionIndex) || definitionIndex < 0) return null;
    const exampleRaw = passage.getAttribute('data-example-index');
    const exampleIndex = exampleRaw == null ? null : Number(exampleRaw);
    if (exampleIndex != null && (!Number.isInteger(exampleIndex) || exampleIndex < 0)) return null;
    return { text, definitionIndex, exampleIndex };
  }

  private selectionInHost(selection: Selection): boolean {
    if (selection.rangeCount === 0) return false;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const anchor = node instanceof Element ? node : node.parentElement;
    return !!anchor && this.host.nativeElement.contains(anchor);
  }
}

function appearanceOf(element: StoredElement): { color: string; style: HighlightStyle } {
  return {
    color: scoreColor(
      element.mode,
      element.modeProgress[element.mode],
      readStepGoal(element.language),
    ).color,
    style: 'solid',
  };
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

function selectionCoversPassage(passage: Element, range: Range): boolean {
  const covered = document.createRange();
  covered.selectNodeContents(passage);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, covered) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, covered) >= 0
  );
}
