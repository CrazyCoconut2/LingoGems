import { Component, computed, effect, input, output, signal } from '@angular/core';
import { languageDisplayName } from 'collection';
import { FeedbackTranslation } from '../translate/feedback-translation';
import {
  correctRecallAnswer,
  evaluateRecallAnswer,
  readStoredAiCredentials,
  type RecallExtra,
  type RecallMistake,
  type RecallSense,
} from 'ai';

const ANSWER_MAX = 1000;

export type RecallFinish = {
  score: number;
  answer: string;
  explanation: string;
  by: 'user' | 'ai';
  extra: boolean;
};

export type RecallExample = {
  text: string;
  /** 1-based position of the definition this sentence belongs to. */
  definition: number;
};

type RecallView = {
  coverage: number;
  feedback: string;
  extra: RecallExtra | null;
  gaveUp: boolean;
};

/** Recall the meanings of one headword before its definitions are shown. */
@Component({
  selector: 'app-definition-recall',
  imports: [FeedbackTranslation],
  template: `
    <section class="recall" [attr.aria-label]="'Definitions of ' + lemma()">
      @if (result(); as scored) {
        @if (!cleared()) {
          <section
            class="result"
            [class.gave-up]="scored.gaveUp"
            [style.--score-mix]="scoreMix(scored)"
            [attr.aria-label]="scoreLabel(scored)"
          >
            <div class="result-head">
              <p class="score">
                {{ scored.coverage }}<span class="max">/10</span>
                @if (scored.extra) {
                  <span class="bonus">+1</span>
                }
              </p>
              <div class="result-tools">
                <app-feedback-translation
                  #note
                  [text]="scored.gaveUp ? '' : scored.feedback"
                  [sourceLang]="learningLanguage()"
                  [targetLang]="supportLanguage()"
                />
                <button type="button" class="clear" aria-label="Clear" (click)="clearResult()">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
            @if (scored.gaveUp) {
              <p class="hint">You gave up.</p>
            } @else if (scored.feedback) {
              <p class="feedback">{{ scored.feedback }}</p>
              @if (note.shown(); as text) {
                <p class="feedback-translation">{{ text }}</p>
              }
            }
          </section>
        }
        @if (scored.extra; as extra) {
          @if (extraChoice() === 'pending') {
            <div class="extra">
              <p class="label">Another meaning</p>
              <p>{{ extra.gloss }}</p>
              @if (extra.example) {
                <p class="example">{{ extra.example }}</p>
              }
              @if (extra.equivalent) {
                <p class="equivalent">{{ extra.equivalent }}</p>
              }
              <div class="actions">
                <button type="button" class="btn btn-secondary" (click)="dismissExtra()">
                  Dismiss
                </button>
                <button type="button" class="btn btn-primary" (click)="acceptExtraSense()">
                  Accept
                </button>
              </div>
            </div>
          } @else if (extraChoice() === 'accepted') {
            <p class="hint">Added to this element.</p>
          }
        }
      } @else {
        <div class="prompt">
          <p class="ask">Write the {{ definitionCountLabel() }} of this element.</p>
          <div class="prompt-meta">
            @if (canSwitchLanguage()) {
              <div class="languages" role="group" aria-label="Answer language">
                <button
                  type="button"
                  [class.active]="answerSide() === 'support'"
                  [attr.aria-pressed]="answerSide() === 'support'"
                  [disabled]="busy() !== null"
                  (click)="chooseLanguage('support')"
                >
                  {{ languageName(supportLanguage()) }}
                </button>
                <button
                  type="button"
                  [class.active]="answerSide() === 'learning'"
                  [attr.aria-pressed]="answerSide() === 'learning'"
                  [disabled]="busy() !== null"
                  (click)="chooseLanguage('learning')"
                >
                  {{ languageName(learningLanguage()) }}
                </button>
              </div>
            } @else if (answerLanguageName(); as language) {
              <p class="hint">Write it in {{ language }}.</p>
            }
            <div class="prompt-tools">
              @if (hintStep() < 1) {
                <button
                  type="button"
                  class="tool icon"
                  aria-label="Hint"
                  title="Hint"
                  [disabled]="busy() !== null"
                  (click)="showHint()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
                    />
                    <path d="M9 18h6" />
                    <path d="M10 22h4" />
                  </svg>
                </button>
              }
              @if (correctsGrammar()) {
                <button
                  type="button"
                  class="tool icon"
                  aria-label="Correct"
                  title="Correct"
                  [disabled]="!canCorrect()"
                  [attr.aria-busy]="busy() === 'correct' ? true : null"
                  (click)="correct()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 16 6-12 6 12" />
                    <path d="M8 12h8" />
                    <path d="m16 20 2 2 4-4" />
                  </svg>
                </button>
              }
            </div>
          </div>
        </div>
        @if (mistakes(); as found) {
          <div class="mistakes" aria-label="Corrections">
            @if (found.length) {
              <ul>
                @for (mistake of found; track $index) {
                  <li>
                    <span class="wrote">{{ mistake.wrote }}</span>
                    <span class="arrow" aria-hidden="true">→</span>
                    <span>{{ mistake.correction }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="hint">Nothing to correct.</p>
            }
          </div>
        }
        <form (submit)="submit($event)">
          <textarea
            rows="3"
            [attr.maxlength]="answerMax"
            [disabled]="busy() !== null"
            [value]="draft()"
            [attr.aria-label]="'Definitions of ' + lemma()"
            [attr.placeholder]="placeholder()"
            (input)="onDraft($event)"
          ></textarea>
          @if (hintStep() >= 1) {
            @if (examples().length) {
              <ul class="examples" aria-label="Examples">
                @for (example of examples(); track $index) {
                  <li>
                    <span class="example-index" [attr.aria-label]="'Definition ' + example.definition">
                      {{ example.definition }}
                    </span>
                    <span>{{ example.text }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="hint">No examples stored.</p>
            }
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <div class="actions">
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="busy() !== null"
              (click)="giveUp()"
            >
              Give up
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">Submit</button>
          </div>
        </form>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .recall {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .prompt,
    form {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .ask,
    .score,
    .feedback,
    .feedback-translation,
    .extra p {
      margin: 0;
    }

    .ask {
      font-size: 1.05rem;
      font-weight: 650;
    }

    .prompt-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem 0.75rem;
    }

    .languages {
      display: flex;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
    }

    .languages button {
      border: none;
      border-radius: 999px;
      padding: 0.28rem 0.7rem;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
    }

    .languages button.active {
      background: var(--accent);
      color: white;
    }

    .languages button:disabled {
      cursor: not-allowed;
    }

    .prompt-tools {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      margin-left: auto;
    }

    .tool {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.28rem 0.7rem;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
    }

    .tool.icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.85rem;
      height: 1.85rem;
      padding: 0;
    }

    .tool svg {
      width: 0.95rem;
      height: 0.95rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tool:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .hint,
    .label {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    .label {
      font-weight: 650;
    }

    .mistakes {
      padding: 0.7rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
    }

    .mistakes ul,
    .examples {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .mistakes li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: baseline;
    }

    .wrote {
      color: var(--text-muted);
      text-decoration: line-through;
    }

    .arrow {
      color: var(--text-muted);
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      resize: vertical;
    }

    textarea:focus {
      outline: none;
      border-color: var(--accent-border);
    }

    textarea:disabled {
      opacity: 0.6;
    }

    .examples li {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      color: var(--text);
    }

    .example-index {
      flex: none;
      min-width: 1.15rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .error {
      margin: 0;
      color: var(--danger);
      font-size: 0.82rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.6rem;
    }

    .score {
      font-size: 1.35rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .result {
      --score-color: color-mix(
        in srgb,
        var(--gem-definition) calc(var(--score-mix) * 100%),
        var(--danger)
      );
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.8rem 0.85rem;
      border: 1px solid color-mix(in srgb, var(--score-color) 46%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--score-color) 16%, transparent);
    }

    .result .score {
      color: var(--score-color);
    }

    .result.gave-up {
      --score-color: var(--text-muted);
    }

    .result-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
    }

    .result-tools {
      display: flex;
      align-items: center;
      gap: 0.15rem;
      margin-left: auto;
    }

    .clear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.6rem;
      height: 1.6rem;
      margin: -0.1rem -0.15rem 0 0;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .clear:hover {
      color: var(--text);
    }

    .clear svg {
      width: 0.9rem;
      height: 0.9rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
    }

    .max,
    .bonus {
      color: var(--text-muted);
      font-size: 0.95rem;
      font-weight: 650;
    }

    .bonus {
      margin-left: 0.35rem;
      color: var(--gem-definition);
    }

    .feedback,
    .feedback-translation {
      line-height: 1.45;
    }

    .feedback-translation {
      color: var(--text-muted);
    }

    .extra {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.75rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
    }

    .example,
    .equivalent {
      color: var(--text-muted);
    }
  `,
})
export class DefinitionRecall {
  readonly answerMax = ANSWER_MAX;
  readonly elementId = input.required<string>();
  readonly lemma = input.required<string>();
  readonly learningLanguage = input.required<string>();
  /** Support language, or '' when this element has none. */
  readonly supportLanguage = input('');
  /** Which of the two languages the answer is written in. */
  readonly answerSide = signal<'support' | 'learning'>('support');
  readonly senses = input.required<readonly RecallSense[]>();
  readonly examples = input.required<readonly RecallExample[]>();
  readonly finished = output<RecallFinish>();
  readonly acceptExtra = output<RecallExtra>();

  readonly draft = signal('');
  readonly hintStep = signal(0);
  readonly mistakes = signal<RecallMistake[] | null>(null);
  readonly result = signal<RecallView | null>(null);
  readonly extraChoice = signal<'pending' | 'accepted' | 'dismissed'>('pending');
  readonly error = signal('');
  readonly busy = signal<'correct' | 'score' | null>(null);
  readonly cleared = signal(false);

  readonly canSwitchLanguage = computed(() => {
    const support = this.supportLanguage().trim().toLowerCase();
    const learning = this.learningLanguage().trim().toLowerCase();
    return !!support && support !== learning;
  });
  readonly answerLanguage = computed(() => {
    const learning = this.learningLanguage().trim().toLowerCase();
    const support = this.supportLanguage().trim().toLowerCase();
    if (this.canSwitchLanguage() && this.answerSide() === 'support') return support;
    return learning;
  });
  readonly correctsGrammar = computed(
    () => this.answerLanguage() === this.learningLanguage().trim().toLowerCase(),
  );
  readonly answerLanguageName = computed(() => languageDisplayName(this.answerLanguage()));

  private correctTicket = 0;
  private scoreTicket = 0;

  constructor() {
    effect(() => {
      this.elementId();
      this.correctTicket += 1;
      this.scoreTicket += 1;
      this.draft.set('');
      this.answerSide.set('support');
      this.hintStep.set(0);
      this.mistakes.set(null);
      this.result.set(null);
      this.extraChoice.set('pending');
      this.error.set('');
      this.busy.set(null);
      this.cleared.set(false);
    });
  }

  languageName(code: string): string {
    return languageDisplayName(code);
  }

  chooseLanguage(side: 'support' | 'learning'): void {
    if (this.busy() !== null || !this.canSwitchLanguage() || side === this.answerSide()) return;
    this.answerSide.set(side);
    this.mistakes.set(null);
    this.error.set('');
  }

  placeholder(): string {
    const language = this.answerLanguageName();
    return language ? `In ${language}` : 'What it means';
  }

  definitionCountLabel(): string {
    const count = this.senses().length;
    return count === 1 ? '1 definition' : `${count} definitions`;
  }

  canCorrect(): boolean {
    return this.busy() === null && !!this.draft().trim();
  }

  canSubmit(): boolean {
    return this.busy() === null && !!this.draft().trim();
  }

  onDraft(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.draft.set(target.value);
  }

  scoreLabel(scored: RecallView): string {
    const bonus = scored.extra ? ', plus 1' : '';
    return `Score ${scored.coverage} out of 10${bonus}`;
  }

  /** 0 is fully red and 10 is fully green. */
  scoreMix(scored: RecallView): number {
    return Math.min(1, Math.max(0, scored.coverage / 10));
  }

  showHint(): void {
    if (this.busy() !== null || this.result() || this.hintStep() >= 1) return;
    this.hintStep.set(1);
  }

  giveUp(): void {
    if (this.busy() !== null || this.result()) return;
    this.finished.emit({ score: 0, answer: '', explanation: '', by: 'user', extra: false });
    this.result.set({ coverage: 0, feedback: '', extra: null, gaveUp: true });
  }

  clearResult(): void {
    this.cleared.set(true);
  }

  dismissExtra(): void {
    if (this.extraChoice() !== 'pending') return;
    this.extraChoice.set('dismissed');
  }

  acceptExtraSense(): void {
    const extra = this.result()?.extra;
    if (!extra || this.extraChoice() !== 'pending') return;
    this.extraChoice.set('accepted');
    this.acceptExtra.emit(extra);
  }

  async correct(): Promise<void> {
    if (!this.canCorrect() || !this.correctsGrammar()) return;
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      return;
    }
    const ticket = ++this.correctTicket;
    const elementId = this.elementId();
    this.busy.set('correct');
    this.error.set('');
    try {
      const correction = await correctRecallAnswer({
        language: this.learningLanguage(),
        text: this.draft(),
      });
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      this.draft.set(correction.corrected);
      this.mistakes.set(correction.mistakes);
    } catch {
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      this.error.set('Could not correct this.');
    } finally {
      if (ticket === this.correctTicket) this.busy.set(null);
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;
    void this.score();
  }

  private async score(): Promise<void> {
    const answer = this.draft().trim();
    if (!answer || this.result()) return;
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      return;
    }
    const ticket = ++this.scoreTicket;
    const elementId = this.elementId();
    this.busy.set('score');
    this.error.set('');
    try {
      const senses = this.correctsGrammar()
        ? this.senses().map((sense) => ({ gloss: sense.gloss }))
        : this.senses();
      const evaluation = await evaluateRecallAnswer({
        lemma: this.lemma(),
        learningLanguage: this.learningLanguage(),
        answerLanguage: this.answerLanguage(),
        answer,
        senses,
      });
      if (ticket !== this.scoreTicket || this.elementId() !== elementId || !evaluation.feedback) {
        if (ticket === this.scoreTicket && this.elementId() === elementId) {
          this.error.set('Could not score this answer.');
        }
        return;
      }
      const extra = evaluation.extra;
      this.finished.emit({
        score: evaluation.coverage + (extra ? 1 : 0),
        answer,
        explanation: evaluation.feedback,
        by: 'ai',
        extra: !!extra,
      });
      this.result.set({
        coverage: evaluation.coverage,
        feedback: evaluation.feedback,
        extra,
        gaveUp: false,
      });
    } catch {
      if (ticket !== this.scoreTicket || this.elementId() !== elementId) return;
      this.error.set('Could not score this answer.');
    } finally {
      if (ticket === this.scoreTicket && this.busy() === 'score') this.busy.set(null);
    }
  }
}
