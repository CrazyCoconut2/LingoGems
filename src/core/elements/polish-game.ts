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
import {
  generateElementFromSelection,
  generateExamples,
  gradeDefinition,
  translateTexts,
  type GradedDefinition,
} from 'ai';
import {
  DEFAULT_DEFINITION_GEM,
  definitionEligibleForGames,
  definitionSelfMentionWarningFor,
  displayTitle,
  elementModeLabel,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  languageDisplayName,
  parsePassage,
  saveElement,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementMetadata,
  type HighlightStyle,
  type StoredElement,
} from 'collection';
import { ExtractPassage } from './extract-game';
import { ModeIcon } from './mode-icon';
import { comfortColor } from './comfort-palette';
import { ModeProgress } from './mode-progress';
import { Reveal } from './reveal';
import { readStepGoal } from './step-goal';

const ANSWER_MAX = 500;

type AnswerLanguage = 'original' | 'english';

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

/** Drilling: recall each definition. A model scores how close the meaning is. */
@Component({
  selector: 'app-polish-game',
  imports: [ExtractPassage, ModeIcon, ModeProgress, NgTemplateOutlet, Reveal],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="modeLabel(3) + ', ' + shownTitle()"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-row">
            <div class="mode-mark">
              <app-mode-icon [mode]="3" />
              <span>{{ modeLabel(3) }}</span>
            </div>
            <app-mode-progress
              [mode]="3"
              [succeeded]="element().modeProgress[3]"
              [goal]="goal()"
              [color]="comfortColor(element().comfort)"
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
              <li class="sense">
                <p class="sense-number">{{ index + 1 }}</p>
                @if (definitionWarning(definition.text); as warning) {
                  <p class="warning" role="status">{{ warning }}</p>
                } @else {
                  @if (supportAvailable()) {
                    <div
                      class="lang"
                      role="group"
                      [attr.aria-label]="'Language for sense ' + (index + 1)"
                    >
                      <button
                        type="button"
                        [class.on]="answerLanguage(index) === 'original'"
                        [attr.aria-pressed]="answerLanguage(index) === 'original'"
                        [disabled]="askingGrade() === index"
                        (click)="setLanguage(index, 'original')"
                      >
                        {{ originalLanguageName() }}
                      </button>
                      <button
                        type="button"
                        [class.on]="answerLanguage(index) === 'english'"
                        [attr.aria-pressed]="answerLanguage(index) === 'english'"
                        [disabled]="askingGrade() === index"
                        (click)="setLanguage(index, 'english')"
                      >
                        English
                      </button>
                    </div>
                  }
                  <label class="field-label" [attr.for]="'polish-definition-' + index">
                    Definition
                  </label>
                  <textarea
                    [id]="'polish-definition-' + index"
                    rows="3"
                    [value]="draftAt(index)"
                    [attr.maxlength]="answerMax"
                    [disabled]="askingGrade() === index"
                    placeholder="Write the definition"
                    (input)="onDraft(index, $event)"
                  ></textarea>
                  @if (!gradeAt(index)) {
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="aiBusy() || !draftAt(index).trim()"
                      [attr.aria-busy]="askingGrade() === index ? true : null"
                      (click)="evaluate(index)"
                    >
                      Evaluate
                    </button>
                  }
                  <button
                    type="button"
                    class="example-btn"
                    aria-label="Example"
                    title="Example"
                    [disabled]="aiBusy() || !storedGloss(index)"
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
                        sentence of exampleList(index);
                        track $index;
                        let exampleIndex = $index
                      ) {
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
                  @if (gradeAt(index); as grade) {
                    <div class="result">
                      @if (translationAt(index); as translated) {
                        <p class="field-label">Translation</p>
                        <p class="judged">{{ translated }}</p>
                      }
                      <p class="field-label">Score</p>
                      <p class="score">{{ grade.score }}</p>
                      <p class="explanation">{{ grade.explanation }}</p>
                      @if (storedGloss(index); as gloss) {
                        <app-extract-passage
                          [definitionIndex]="index"
                          [parts]="highlightPassage(gloss)"
                          (visit)="visitHighlight($event)"
                          (collide)="collision.set($event)"
                        />
                        @if (passagePick(index, null); as pick) {
                          <ng-container *ngTemplateOutlet="lookup; context: { pick: pick }" />
                        }
                      }
                      @if (storedEnglish(index); as english) {
                        <ul class="equivalents">
                          <li>
                            <app-reveal [text]="english" [language]="element().language" />
                          </li>
                        </ul>
                      }
                    </div>
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
    .example-btn:disabled,
    .lang button:disabled {
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
    .examples {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definitions,
    .sense,
    .examples,
    .result {
      display: flex;
      flex-direction: column;
    }

    .definitions {
      gap: 0.85rem;
    }

    .sense,
    .examples,
    .result {
      gap: 0.55rem;
    }

    .sense {
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--surface-2) 72%, var(--surface));
    }

    .sense-number {
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
    }

    .lang {
      display: inline-flex;
      align-self: flex-start;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
    }

    .lang button {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 650;
      padding: 0.35rem 0.7rem;
      cursor: pointer;
    }

    .lang button.on {
      background: var(--surface);
      color: var(--text);
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .field-label {
      font-size: 0.78rem;
      font-weight: 650;
      color: var(--text-muted);
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 5.5rem;
      resize: vertical;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
    }

    textarea:disabled {
      opacity: 0.45;
    }

    .sense > .btn {
      align-self: flex-start;
    }

    .score {
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .explanation {
      line-height: 1.45;
    }

    .judged {
      color: var(--text-muted);
      line-height: 1.45;
    }

    .example-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: flex-start;
      width: 1.8rem;
      height: 1.8rem;
      padding: 0;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .example-btn:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .example-btn svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
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
export class PolishGame {
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
  readonly answerMax = ANSWER_MAX;

  readonly drafts = signal<string[]>([]);
  readonly languages = signal<AnswerLanguage[]>([]);
  readonly grades = signal<Array<GradedDefinition | null>>([]);
  readonly translations = signal<string[]>([]);
  readonly examples = signal<string[][]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly askingExample = signal<number | null>(null);
  readonly askingGrade = signal<number | null>(null);
  readonly addingSelection = signal(false);
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly passageSelection = signal<PassageSelection | null>(null);

  readonly goal = computed(() => readStepGoal(this.element().language));
  readonly comfortColor = comfortColor;
  readonly supportAvailable = computed(
    () => this.element().language.trim().toLowerCase() !== 'en',
  );
  readonly originalLanguageName = computed(
    () => languageDisplayName(this.element().language) || this.element().language,
  );
  readonly canAddPoint = computed(() => {
    if (this.aiBusy()) return false;
    const element = this.element();
    const goal = this.goal();
    const progress = Math.min(goal, Math.max(0, element.modeProgress[3] ?? 0));
    if (progress >= goal) return false;
    const grades = this.grades();
    const playable = element.definitions
      .map((definition, index) => ({ definition, index }))
      .filter(({ definition }) => definitionEligibleForGames(definition.text, element));
    if (!playable.length) return false;
    return playable.every(({ index }) => grades[index] != null);
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private trackedId = '';
  private alive = true;
  private exampleJob = 0;
  private gradeJob = 0;
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

  definitionWarning(text: string): string {
    return definitionSelfMentionWarningFor(text, this.element());
  }

  shownTitle(title = this.element().title): string {
    return displayTitle(title, this.element().language);
  }

  draftAt(index: number): string {
    return this.drafts()[index] ?? '';
  }

  answerLanguage(index: number): AnswerLanguage {
    if (!this.supportAvailable()) return 'original';
    return this.languages()[index] ?? 'original';
  }

  gradeAt(index: number): GradedDefinition | null {
    return this.grades()[index] ?? null;
  }

  translationAt(index: number): string {
    return this.translations()[index] ?? '';
  }

  exampleList(index: number): string[] {
    return this.examples()[index] ?? [];
  }

  storedGloss(index: number): string {
    return parsePassage(this.element().definitions[index]?.text ?? '').text.trim();
  }

  storedEnglish(index: number): string {
    const passage = parsePassage(this.element().definitions[index]?.text ?? '');
    return passage.translations.find((item) => item.language === 'en')?.text.trim() ?? '';
  }

  aiBusy(): boolean {
    return (
      this.busy() ||
      this.addingSelection() ||
      this.askingExample() !== null ||
      this.askingGrade() !== null
    );
  }

  onDraft(index: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value.slice(0, ANSWER_MAX);
    this.writeRow(this.drafts, index, value);
    this.clearGrade(index);
  }

  setLanguage(index: number, language: AnswerLanguage): void {
    if (!this.supportAvailable() || this.askingGrade() === index) return;
    if (this.answerLanguage(index) === language) return;
    const next = this.languages().slice();
    next[index] = language;
    this.languages.set(next);
    this.clearGrade(index);
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
    if (!definition || !gloss || !definitionEligibleForGames(definition.text, element)) return;
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

  async evaluate(index: number): Promise<void> {
    if (this.aiBusy() || this.gradeAt(index) || !this.draftAt(index).trim()) return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = this.storedGloss(index);
    if (!definition || !gloss || !definitionEligibleForGames(definition.text, element)) return;
    const answer = this.draftAt(index).trim();
    const language = this.answerLanguage(index);
    const inEnglish = language === 'english';
    const job = ++this.gradeJob;
    this.askingGrade.set(index);
    this.error.set('');
    try {
      let judged = answer;
      if (inEnglish) {
        try {
          const translated = await translateTexts({
            texts: [answer],
            sourceLang: 'en',
            targetLang: element.language,
          });
          judged = translated[0]?.trim() ?? '';
        } catch {
          if (this.alive && job === this.gradeJob && this.element().id === element.id) {
            this.error.set('Could not translate that definition.');
          }
          return;
        }
        if (!this.alive || job !== this.gradeJob || this.element().id !== element.id) return;
        if (
          this.draftAt(index).trim() !== answer ||
          this.answerLanguage(index) !== language ||
          !judged
        ) {
          if (!judged && this.draftAt(index).trim() === answer) {
            this.error.set('Could not translate that definition.');
          }
          return;
        }
      }
      const grade = await gradeDefinition({
        language: element.language,
        lemma: element.title,
        gloss,
        answer: judged,
      });
      if (!this.alive || job !== this.gradeJob || this.element().id !== element.id) return;
      if (this.draftAt(index).trim() !== answer || this.answerLanguage(index) !== language) return;
      const grades = this.grades().slice();
      grades[index] = grade;
      this.grades.set(grades);
      if (inEnglish) {
        const translations = this.translations().slice();
        translations[index] = judged;
        this.translations.set(translations);
      }
    } catch {
      if (this.alive && job === this.gradeJob && this.element().id === element.id) {
        this.error.set('Could not evaluate that definition.');
      }
    } finally {
      if (this.alive && job === this.gradeJob) this.askingGrade.set(null);
    }
  }

  async addPoint(): Promise<void> {
    if (!this.canAddPoint()) return;
    const element = this.element();
    const goal = readStepGoal(element.language);
    const current = Math.min(goal, Math.max(0, element.modeProgress[3] ?? 0));
    if (current >= goal) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({
        ...element,
        modeProgress: { ...element.modeProgress, 3: current + 1 },
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

  private clearGrade(index: number): void {
    if (this.grades()[index] == null && !(this.translations()[index] ?? '')) return;
    const grades = this.grades().slice();
    grades[index] = null;
    this.grades.set(grades);
    const translations = this.translations().slice();
    translations[index] = '';
    this.translations.set(translations);
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
    if (pick.exampleIndex == null) return this.storedGloss(pick.definitionIndex);
    return this.examples()[pick.definitionIndex]?.[pick.exampleIndex] ?? '';
  }

  private rememberElement(id: string, count: number): void {
    if (id !== this.trackedId) {
      this.trackedId = id;
      this.drafts.set(Array.from({ length: count }, () => ''));
      this.languages.set(Array.from({ length: count }, () => 'original' as const));
      this.grades.set(Array.from({ length: count }, () => null));
      this.translations.set(Array.from({ length: count }, () => ''));
      this.examples.set(Array.from({ length: count }, () => []));
      this.passageSelection.set(null);
      this.collision.set(null);
      this.error.set('');
      this.askingExample.set(null);
      this.askingGrade.set(null);
      this.addingSelection.set(false);
      return;
    }
    if (this.drafts().length === count) return;
    const drafts = this.drafts();
    const languages = this.languages();
    const grades = this.grades();
    const translations = this.translations();
    const examples = this.examples();
    this.drafts.set(Array.from({ length: count }, (_, index) => drafts[index] ?? ''));
    this.languages.set(
      Array.from({ length: count }, (_, index) => languages[index] ?? 'original'),
    );
    this.grades.set(Array.from({ length: count }, (_, index) => grades[index] ?? null));
    this.translations.set(Array.from({ length: count }, (_, index) => translations[index] ?? ''));
    this.examples.set(Array.from({ length: count }, (_, index) => examples[index] ?? []));
  }

  private writeRow(rows: WritableSignal<string[]>, index: number, value: string): void {
    const next = rows().slice();
    next[index] = value;
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
    color: comfortColor(element.comfort),
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
