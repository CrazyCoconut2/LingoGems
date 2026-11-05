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
} from '@angular/core';
import { generateElementFromSelection, generateExamples } from 'ai';
import {
  DEFAULT_DEFINITION_GEM,
  definitionEligibleForGames,
  definitionSelfMentionWarningFor,
  displayTitle,
  elementModeLabel,
  formMatchesTerm,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  parsePassage,
  saveElement,
  surfaceSpans,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementMetadata,
  type HighlightStyle,
  type StoredElement,
} from 'collection';
import { ExtractPassage } from './extract-game';
import { DefinitionGemIcon } from './definition-gem';
import { gemAccessibleName } from './gem-meanings';
import { ModeIcon } from './mode-icon';
import { metadataChipColor } from './metadata-colors';
import { scoreColor } from './mode-palette';
import { ModeProgress } from './mode-progress';
import { Reveal } from './reveal';
import { readStepGoal } from './step-goal';

const ANSWER_MAX = 200;

type ClozeGrade = '' | 'red' | 'orange' | 'green';

type ClozePart =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; answer: string; draft: string; grade: ClozeGrade };

type ClozeExample = { parts: ClozePart[] };

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

/** Refine: recall the element or any form. An example blank grades that exact surface. */
@Component({
  selector: 'app-refine-game',
  imports: [ExtractPassage, DefinitionGemIcon, ModeIcon, ModeProgress, NgTemplateOutlet, Reveal],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="recalled() ? 'Refine, ' + shownTitle() : 'Refine'"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-row">
            <div class="mode-mark">
              <app-mode-icon [mode]="2" />
              <span>{{ modeLabel(2) }}</span>
            </div>
            <app-mode-progress
              [mode]="2"
              [succeeded]="element().modeProgress[2]"
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
          <h2 [class.concealed]="!recalled()" [attr.aria-hidden]="recalled() ? null : true">
            @if (recalled()) {
              {{ shownTitle() }}
            } @else {
              <span class="cue-shown">{{ revealedPrefix() }}</span
              ><span class="cue-rest">{{ hiddenSuffix() }}</span>
            }
          </h2>
          @if (!recalled() && canRevealLetter()) {
            <button type="button" class="cue" [disabled]="busy()" (click)="revealLetter()">
              Reveal a letter
            </button>
          }
          <span class="sr" aria-live="polite">{{ cueAnnouncement() }}</span>
          <label class="field-label" for="refine-recall">Element or a form</label>
          <div class="guess">
            <input
              id="refine-recall"
              type="text"
              autocomplete="off"
              spellcheck="false"
              [value]="recall()"
              [attr.maxlength]="answerMax"
              [disabled]="busy()"
              [readOnly]="recalled()"
              placeholder="Write the element or a form"
              (input)="onRecall($event)"
              (keydown.enter)="submitRecall($event)"
            />
            @if (!recalled()) {
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="busy() || !recall().trim()"
                (click)="submitRecall()"
              >
                Submit
              </button>
            }
          </div>
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
                <span
                  class="sense-gem"
                  [attr.title]="gemAccessibleName(element().language, definition.gem)"
                  [attr.aria-label]="gemAccessibleName(element().language, definition.gem)"
                >
                  <app-definition-gem [gem]="definition.gem" />
                </span>
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
                        <app-reveal [text]="translation.text" [language]="element().language" />
                      </li>
                    }
                  </ul>
                }
                @if (passagePick(index, null); as pick) {
                  <ng-container *ngTemplateOutlet="lookup; context: { pick: pick }" />
                }
                @if (entries(definition.metadata).length) {
                  <ul class="sense-meta">
                    @for (entry of entries(definition.metadata); track entry.key) {
                      @let color = metaColor(entry.key, entry.value);
                      <li [class.colored]="color" [style.--meta-color]="color">
                        <span class="sense-meta-key">{{ label(entry.key) }}</span>
                        {{ label(entry.value) }}
                      </li>
                    }
                  </ul>
                }
                @if (definitionWarning(definition.text); as warning) {
                  <p class="warning" role="status">{{ warning }}</p>
                } @else {
                  <button
                    type="button"
                    class="example-btn"
                    aria-label="Example"
                    title="Example"
                    [disabled]="aiBusy() || !passage.text"
                    [attr.aria-busy]="askingExample() === index ? true : null"
                    (click)="generateExample(index)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                      />
                      <path
                        d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
                      />
                    </svg>
                  </button>
                  @if (exampleList(index).length) {
                    <ul class="examples">
                      @for (
                        example of exampleList(index);
                        track $index;
                        let exampleIndex = $index
                      ) {
                        <li>
                          <div class="example-quote cloze">
                            @for (part of example.parts; track $index; let partIndex = $index) {
                              @if (part.kind === 'text') {
                                <app-extract-passage
                                  [inline]="true"
                                  [definitionIndex]="index"
                                  [exampleIndex]="exampleIndex"
                                  [parts]="highlightPassage(part.text, true)"
                                  (visit)="visitHighlight($event)"
                                  (collide)="collision.set($event)"
                                />
                              } @else if (part.kind === 'blank') {
                                <span class="blank">
                                  <input
                                    type="text"
                                    autocomplete="off"
                                    spellcheck="false"
                                    aria-label="Form"
                                    [value]="part.draft"
                                    [attr.maxlength]="answerMax"
                                    [disabled]="busy()"
                                    [readOnly]="part.grade === 'green'"
                                    [class.grade-red]="part.grade === 'red'"
                                    [class.grade-orange]="part.grade === 'orange'"
                                    [class.grade-green]="part.grade === 'green'"
                                    (input)="onBlank(index, exampleIndex, partIndex, $event)"
                                    (keydown.enter)="
                                      submitBlank(index, exampleIndex, partIndex, $event)
                                    "
                                  />
                                  @if (part.grade !== 'green') {
                                    <button
                                      type="button"
                                      class="blank-submit"
                                      aria-label="Submit"
                                      [disabled]="busy() || !part.draft.trim()"
                                      (click)="submitBlank(index, exampleIndex, partIndex)"
                                    >
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M20 6 9 17l-5-5" />
                                      </svg>
                                    </button>
                                  }
                                </span>
                              }
                            }
                          </div>
                          @if (passagePick(index, exampleIndex); as pick) {
                            <ng-container *ngTemplateOutlet="lookup; context: { pick: pick }" />
                          }
                        </li>
                      }
                    </ul>
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

    h2.concealed {
      user-select: none;
      -webkit-user-select: none;
    }

    .cue-rest {
      filter: blur(0.55em);
      pointer-events: none;
    }

    .cue {
      align-self: flex-start;
      margin: -0.35rem 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--accent-text);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      cursor: pointer;
    }

    .cue:hover:not(:disabled) {
      color: var(--text);
    }

    .cue:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
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
    .example-btn:disabled,
    .blank-submit:disabled {
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

    .error,
    .warning {
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
      position: relative;
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .sense-gem {
      position: absolute;
      top: 0.9rem;
      right: 0.9rem;
      width: 1.15rem;
      height: 1.15rem;
    }

    .sense:has(.sense-gem) > app-extract-passage {
      padding-right: 1.55rem;
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

    .sense-meta li.colored {
      color: var(--meta-color);
      border-color: color-mix(in srgb, var(--meta-color) 55%, transparent);
      background: color-mix(in srgb, var(--meta-color) 14%, transparent);
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

    .guess {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .guess input {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .guess input[readonly] {
      color: var(--text-muted);
    }

    .example-btn,
    .blank-submit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .example-btn {
      align-self: flex-start;
      width: 1.8rem;
      height: 1.8rem;
      border-radius: 0.4rem;
    }

    .example-btn:hover:not(:disabled),
    .blank-submit:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .example-btn svg,
    .blank-submit svg {
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .example-btn svg {
      width: 1rem;
      height: 1rem;
    }

    .example-quote {
      padding: 0.1rem 0 0.1rem 0.85rem;
      border-left: 3px solid rgba(var(--accent-rgb), 0.45);
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.9;
    }

    .cloze {
      white-space: pre-wrap;
    }

    .blank {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      white-space: nowrap;
      vertical-align: baseline;
    }

    .blank input {
      width: 7.5rem;
      padding: 0.2rem 0.45rem;
      border-radius: 8px;
      font-size: inherit;
    }

    .blank input.grade-red {
      border-color: var(--danger);
    }

    .blank input.grade-orange {
      border-color: #f5a142;
    }

    .blank input.grade-green {
      border-color: #3dcc78;
    }

    .blank-submit {
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 0.35rem;
    }

    .blank-submit svg {
      width: 0.95rem;
      height: 0.95rem;
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
export class RefineGame {
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
  readonly gemAccessibleName = gemAccessibleName;
  readonly answerMax = ANSWER_MAX;

  readonly recall = signal('');
  readonly recalled = signal(false);
  /** Graphemes of the title that the letter cue has uncovered. */
  readonly revealedCount = signal(0);
  readonly titleChars = computed(() => graphemes(this.shownTitle()));
  readonly examples = signal<ClozeExample[][]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly askingExample = signal<number | null>(null);
  readonly addingSelection = signal(false);
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly passageSelection = signal<PassageSelection | null>(null);

  readonly goal = computed(() => readStepGoal(this.element().language));
  readonly canAddPoint = computed(() => {
    if (this.aiBusy() || !this.recalled()) return false;
    const element = this.element();
    const goal = this.goal();
    const progress = Math.min(goal, Math.max(0, element.modeProgress[2] ?? 0));
    return progress < goal;
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

  definitionWarning(text: string): string {
    return definitionSelfMentionWarningFor(text, this.element());
  }

  shownTitle(title = this.element().title): string {
    return displayTitle(title, this.element().language);
  }

  revealedPrefix(): string {
    return this.titleChars().slice(0, this.revealedCount()).join('');
  }

  hiddenSuffix(): string {
    return this.titleChars().slice(this.revealedCount()).join('');
  }

  canRevealLetter(): boolean {
    return nextLetterCount(this.titleChars(), this.revealedCount()) > this.revealedCount();
  }

  /** Revealed letters only, so the rest of the title stays unspoken. */
  cueAnnouncement(): string {
    return this.revealedPrefix();
  }

  revealLetter(): void {
    if (this.busy() || this.recalled() || !this.canRevealLetter()) return;
    this.revealedCount.set(nextLetterCount(this.titleChars(), this.revealedCount()));
  }

  exampleList(index: number): ClozeExample[] {
    return this.examples()[index] ?? [];
  }

  aiBusy(): boolean {
    return this.busy() || this.addingSelection() || this.askingExample() !== null;
  }

  onRecall(event: Event): void {
    if (this.recalled()) return;
    this.recall.set((event.target as HTMLInputElement).value.slice(0, ANSWER_MAX));
  }

  submitRecall(event?: Event): void {
    event?.preventDefault();
    if (this.busy() || this.recalled() || !this.recall().trim()) return;
    if (!matchesElement(this.recall(), this.element())) return;
    this.recalled.set(true);
  }

  onBlank(definitionIndex: number, exampleIndex: number, partIndex: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value.slice(0, ANSWER_MAX);
    this.mapExample(definitionIndex, exampleIndex, (example) => ({
      parts: example.parts.map((part, index) => {
        if (index !== partIndex || part.kind !== 'blank' || part.grade === 'green') return part;
        return { ...part, draft: value, grade: '' };
      }),
    }));
  }

  submitBlank(
    definitionIndex: number,
    exampleIndex: number,
    partIndex: number,
    event?: Event,
  ): void {
    event?.preventDefault();
    if (this.busy()) return;
    const part = this.examples()[definitionIndex]?.[exampleIndex]?.parts[partIndex];
    if (!part || part.kind !== 'blank' || part.grade === 'green' || !part.draft.trim()) return;
    const grade = gradeBlank(part.draft, part.answer, this.element());
    this.mapExample(definitionIndex, exampleIndex, (example) => ({
      parts: example.parts.map((item, index) => {
        if (index !== partIndex || item.kind !== 'blank') return item;
        return { ...item, grade };
      }),
    }));
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }

  metaColor(key: string, value: string): string | null {
    return metadataChipColor(this.element().language, 'definitions', key, value);
  }

  /** First letter of a metadata label, leaving the rest of the wording alone. */
  label(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  highlightPassage(text: string, concealCurrent = false): DefinitionHighlightPart[] {
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
        title: concealCurrent ? '' : element.title,
        forms: concealCurrent ? [] : elementFormTexts(element),
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
    if (!definition || !gloss || !definitionEligibleForGames(definition.text, element)) return;
    const job = ++this.exampleJob;
    this.askingExample.set(index);
    this.error.set('');
    try {
      const temporary = (this.examples()[index] ?? []).map((example) => clozeText(example.parts));
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
      const parts = sentence ? clozeParts(sentence, element) : null;
      if (!parts || current.some((item) => clozeText(item.parts).toLowerCase() === key)) {
        this.error.set('No further examples.');
        return;
      }
      const next = this.examples().slice();
      next[index] = [...current, { parts }];
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
    const current = Math.min(goal, Math.max(0, element.modeProgress[2] ?? 0));
    if (current >= goal) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({
        ...element,
        modeProgress: { ...element.modeProgress, 2: current + 1 },
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
          gem: DEFAULT_DEFINITION_GEM,
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
    const example = this.examples()[pick.definitionIndex]?.[pick.exampleIndex];
    return example ? clozeVisible(example.parts) : '';
  }

  private rememberElement(id: string, count: number): void {
    if (id !== this.trackedId) {
      this.trackedId = id;
      this.recall.set('');
      this.recalled.set(false);
      this.revealedCount.set(0);
      this.examples.set(Array.from({ length: count }, () => []));
      this.passageSelection.set(null);
      this.collision.set(null);
      this.error.set('');
      this.askingExample.set(null);
      this.addingSelection.set(false);
      return;
    }
    if (this.examples().length === count) return;
    const examples = this.examples();
    this.examples.set(Array.from({ length: count }, (_, index) => examples[index] ?? []));
  }

  private mapExample(
    definitionIndex: number,
    exampleIndex: number,
    change: (example: ClozeExample) => ClozeExample,
  ): void {
    const next = this.examples().map((row, index) => {
      if (index !== definitionIndex) return row;
      return row.map((example, item) => (item === exampleIndex ? change(example) : example));
    });
    this.examples.set(next);
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

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    );
  }
  return Array.from(text);
}

/** How many graphemes to show so the cue uncovers one more letter. */
function nextLetterCount(chars: readonly string[], from: number): number {
  let index = from;
  while (index < chars.length) {
    index += 1;
    if (/\p{L}/u.test(chars[index - 1] ?? '')) return index;
  }
  return from;
}

function gradeBlank(answer: string, surface: string, element: StoredElement): ClozeGrade {
  if (sameSurface(answer, surface)) return 'green';
  if (matchesElement(answer, element)) return 'orange';
  return 'red';
}

function matchesElement(answer: string, element: StoredElement): boolean {
  const text = answer.trim();
  if (!text) return false;
  if (sameSurface(text, element.title) || formMatchesTerm(element.title, text)) return true;
  return element.definitions.some((definition) =>
    definition.forms.some(
      (form) => sameSurface(text, form.text) || formMatchesTerm(form.text, text),
    ),
  );
}

function sameSurface(left: string, right: string): boolean {
  return normalizeSurface(left) === normalizeSurface(right);
}

function normalizeSurface(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function clozeParts(sentence: string, element: StoredElement): ClozePart[] | null {
  const forms = element.definitions.flatMap((definition) =>
    definition.forms.map((form) => form.text),
  );
  const spans = surfaceSpans(sentence, element.title, forms);
  if (!spans.length) return null;
  const parts: ClozePart[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) parts.push({ kind: 'text', text: sentence.slice(cursor, span.start) });
    parts.push({ kind: 'blank', answer: span.surface, draft: '', grade: '' });
    cursor = span.end;
  }
  if (cursor < sentence.length) parts.push({ kind: 'text', text: sentence.slice(cursor) });
  return parts;
}

function clozeText(parts: readonly ClozePart[]): string {
  return parts.map((part) => (part.kind === 'text' ? part.text : part.answer)).join('');
}

/** The sentence as the learner sees it, so a saved selection does not include a hidden form. */
function clozeVisible(parts: readonly ClozePart[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      return part.draft.trim() || '…';
    })
    .join('');
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
