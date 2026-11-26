import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  applyGrammarOutcome,
  definitionScoreStep,
  grammarCorrectionMarks,
  languageDisplayName,
  readGrammarMistakes,
  reformulationMarks,
  saveReformulation,
  type GrammarInstance,
  type GrammarMark,
  type ReformulationChange,
  type ReformulationMark,
} from 'collection';
import { UpwardQuotePipe } from '../text/upward-quote.pipe';
import { LanguageService } from '../i18n/language.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { FeedbackTranslation } from '../translate/feedback-translation';
import {
  correctRecallAnswer,
  evaluateRecallAnswer,
  readStoredAiCredentials,
  suggestReformulations,
  type RecallExtra,
  type RecallCorrection,
  type RecallSense,
} from 'ai';

const ANSWER_MAX = 1000;
const PRIOR_MAX = 20;

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

type CorrectionRule = {
  key: string;
  rule: string;
  outcome: 'committed' | 'resolved';
  instances: GrammarInstance[];
};

type ShownCorrection = {
  after: string;
  rules: CorrectionRule[];
};

type ShownReformulation = {
  id: string;
  text: string;
  changes: readonly ReformulationChange[];
};

/** Recall the meanings of one headword before its definitions are shown. */
@Component({
  selector: 'app-definition-recall',
  imports: [FeedbackTranslation, UpwardQuotePipe, TranslatePipe],
  host: {
    '[class.quiet]': 'settled() && !result()',
  },
  template: `
    <section class="recall" [attr.aria-label]="definitionsAria()">
      @if (result(); as scored) {
        @if (!cleared()) {
          <section
            class="result"
            [class.gave-up]="scored.gaveUp"
            [style.--score-color]="scored.gaveUp ? null : scoreColor(scored)"
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
                <button type="button" class="clear" [attr.aria-label]="'common.clear' | translate" (click)="clearResult()">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
            @if (scored.gaveUp) {
              <p class="hint">{{ 'recall.gaveUp' | translate }}</p>
            } @else if (scored.feedback) {
              <p class="feedback">{{ scored.feedback | upwardQuote }}</p>
              @if (note.shown(); as text) {
                <p class="feedback-translation">{{ text | upwardQuote }}</p>
              }
            }
          </section>
        }
        @if (scored.extra; as extra) {
          @if (extraChoice() === 'pending') {
            <div class="extra">
              <p class="label">{{ 'recall.anotherMeaning' | translate }}</p>
              <p>{{ extra.gloss }}</p>
              @if (extra.example) {
                <p class="example">{{ extra.example }}</p>
              }
              @if (extra.equivalent) {
                <p class="equivalent">{{ extra.equivalent }}</p>
              }
              <div class="actions">
                <button type="button" class="btn btn-secondary" (click)="dismissExtra()">
                  {{ 'recall.dismiss' | translate }}
                </button>
                <button type="button" class="btn btn-primary" (click)="acceptExtraSense()">
                  {{ 'recall.accept' | translate }}
                </button>
              </div>
            </div>
          } @else if (extraChoice() === 'accepted') {
            <p class="hint">{{ 'recall.added' | translate }}</p>
          }
        }
      } @else if (!settled()) {
        <div class="prompt">
          <p class="ask">
            {{ 'recall.writeDefinitions' | translate: { definitions: definitionCountLabel() } }}
          </p>
          <div class="prompt-meta">
            @if (canSwitchLanguage()) {
              <div class="languages" role="group" [attr.aria-label]="'recall.answerLanguage' | translate">
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
              <p class="hint">
                {{ 'recall.writeIn' | translate: { language: language } }}
              </p>
            }
            <div class="prompt-tools">
              @if (hintStep() < 1) {
                <button
                  type="button"
                  class="tool icon"
                  [attr.aria-label]="'recall.hint' | translate"
                  [attr.title]="'recall.hint' | translate"
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
                  [attr.aria-label]="'recall.correct' | translate"
                  [attr.title]="'recall.correct' | translate"
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
        @if (correction(); as found) {
          <div class="mistakes" [attr.aria-label]="'recall.corrections' | translate">
            @if (found.rules.length) {
              <p class="grammar-sentence">
                @for (part of correctionParts(); track $index) {
                  @if (part.kind === 'fix') {
                    <span class="grammar-mistake" [class.colored]="part.colored">{{
                      part.wrote
                    }}</span>
                    <span class="grammar-fix" [class.colored]="part.colored">{{
                      part.correction
                    }}</span>
                  } @else if (part.kind === 'good') {
                    <span class="grammar-good">{{ part.text }}</span>
                  } @else {
                    <span>{{ part.text }}</span>
                  }
                }
              </p>
              <div class="grammar-rules">
                @for (rule of found.rules; track rule.key) {
                  <button
                    type="button"
                    class="grammar-rule-btn"
                    [class.committed]="rule.outcome === 'committed'"
                    [class.resolved]="rule.outcome === 'resolved'"
                    [class.selected]="ruleColored(rule.key)"
                    [attr.aria-pressed]="ruleColored(rule.key)"
                    [attr.aria-label]="ruleLabel(rule)"
                    (click)="toggleRuleColor(rule.key)"
                  >
                    @if (rule.outcome === 'committed') {
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    } @else {
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    }
                    <span>{{ rule.rule }}</span>
                  </button>
                }
              </div>
            } @else {
              <p class="hint">{{ 'recall.nothingToCorrect' | translate }}</p>
            }
            <div class="reformulation-follow">
              @if (reformulations(); as suggestions) {
                @if (suggestions.length) {
                  <div class="reformulations" [attr.aria-label]="'recall.reformulations' | translate">
                    @for (item of suggestions; track item.id) {
                      <article class="reformulation">
                        <p class="grammar-sentence">
                          @for (part of reformulationParts(item); track $index) {
                            @if (part.kind === 'change') {
                              <span class="grammar-mistake">{{ part.wrote }}</span>
                              <span class="grammar-fix colored">{{ part.reformulation }}</span>
                            } @else {
                              <span>{{ part.text }}</span>
                            }
                          }
                        </p>
                        <ul class="reformulation-changes">
                          @for (change of item.changes; track $index) {
                            <li>
                              <span class="reformulation-swap">
                                <span class="grammar-mistake">{{ change.wrote }}</span>
                                <span class="grammar-fix colored">{{ change.reformulation }}</span>
                              </span>
                              <span>{{ change.reason }}</span>
                            </li>
                          }
                        </ul>
                        <div class="actions">
                          <button
                            type="button"
                            class="btn btn-secondary"
                            [disabled]="busy() !== null"
                            (click)="dismissReformulation(item.id)"
                          >
                            {{ 'recall.dismiss' | translate }}
                          </button>
                          <button
                            type="button"
                            class="btn btn-primary"
                            [disabled]="busy() !== null"
                            (click)="acceptReformulation(item.id)"
                          >
                            {{ 'recall.accept' | translate }}
                          </button>
                        </div>
                      </article>
                    }
                  </div>
                } @else {
                  <p class="hint">{{ 'recall.nothingToReformulate' | translate }}</p>
                }
              } @else if (reformulationSaved()) {
                <p class="hint">{{ 'recall.reformulationSaved' | translate }}</p>
              }
              @if (!reformulations()?.length) {
                <div class="reformulate-offer">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="!canReformulate()"
                    [attr.aria-busy]="busy() === 'reformulate' ? true : null"
                    (click)="reformulate()"
                  >
                    {{ 'recall.reformulate' | translate }}
                  </button>
                </div>
              }
            </div>
          </div>
        }
        <form (submit)="submit($event)">
          <textarea
            rows="3"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            [attr.maxlength]="answerMax"
            [disabled]="busy() !== null"
            [value]="draft()"
            [attr.aria-label]="definitionsAria()"
            [attr.placeholder]="placeholder()"
            (input)="onDraft($event)"
          ></textarea>
          @if (hintStep() >= 1) {
            @if (examples().length) {
              <ul class="examples" [attr.aria-label]="'recall.examples' | translate">
                @for (example of examples(); track $index) {
                  <li>
                    <span
                      class="example-index"
                      [attr.aria-label]="
                        'recall.definitionN' | translate: { index: '' + example.definition }
                      "
                    >
                      {{ example.definition }}
                    </span>
                    <span>{{ example.text }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="hint">{{ 'recall.noExamples' | translate }}</p>
            }
          }
          @if (error()) {
            <p class="error">{{ error() | translate }}</p>
          }
          <div class="actions">
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="busy() !== null"
              (click)="giveUp()"
            >
              {{ 'recall.giveUp' | translate }}
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
              {{ 'common.submit' | translate }}
            </button>
          </div>
        </form>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    :host.quiet {
      display: none;
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

    .examples {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .grammar-sentence {
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .grammar-mistake {
      color: var(--text-muted);
      text-decoration: line-through;
    }

    .grammar-mistake.colored {
      color: var(--danger);
      font-weight: 650;
    }

    .grammar-fix {
      margin-left: 0.28rem;
    }

    .grammar-fix.colored {
      color: var(--score-10);
      font-weight: 650;
    }

    .grammar-good {
      color: var(--score-10);
      font-weight: 650;
    }

    .grammar-rules {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.45rem 0 0;
    }

    .grammar-rule-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      width: auto;
      padding: 0.28rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      line-height: 1.3;
      text-align: left;
      cursor: pointer;
    }

    .grammar-rule-btn svg {
      display: block;
      flex: none;
      width: 0.72rem;
      height: 0.72rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .grammar-rule-btn.committed svg {
      color: var(--danger);
    }

    .grammar-rule-btn.resolved svg {
      color: var(--score-10);
    }

    .grammar-rule-btn.selected {
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .reformulation-follow {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      margin-top: 0.75rem;
    }

    .reformulations {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .reformulation {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      margin: 0;
    }

    .reformulation-changes {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .reformulation-changes li {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.12rem;
      color: var(--text-muted);
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .reformulation-swap {
      color: var(--text);
    }

    .reformulate-offer {
      display: flex;
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
      color: var(--score-10);
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
  private readonly i18n = inject(LanguageService);
  readonly answerMax = ANSWER_MAX;
  readonly elementId = input.required<string>();
  readonly lemma = input.required<string>();
  readonly learningLanguage = input.required<string>();
  /** Support language, or '' when this element has none. */
  readonly supportLanguage = input('');
  /** Which of the two languages the answer is written in. */
  readonly answerSide = signal<'support' | 'learning'>('support');
  readonly senses = input.required<readonly RecallSense[]>();
  /** This open already revealed the definitions, so the prompt cannot return. */
  readonly settled = input(false);
  readonly examples = input.required<readonly RecallExample[]>();
  readonly finished = output<RecallFinish>();
  readonly acceptExtra = output<RecallExtra>();

  readonly draft = signal('');
  readonly hintStep = signal(0);
  readonly correction = signal<ShownCorrection | null>(null);
  readonly coloredRules = signal<readonly string[]>([]);
  readonly reformulations = signal<readonly ShownReformulation[] | null>(null);
  readonly reformulationSaved = signal(false);
  readonly result = signal<RecallView | null>(null);
  readonly extraChoice = signal<'pending' | 'accepted' | 'dismissed'>('pending');
  readonly error = signal('');
  readonly busy = signal<'correct' | 'score' | 'reformulate' | null>(null);
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
  private reformulateTicket = 0;
  /** Corrected sentence last written into the draft. Empty once the learner edits it. */
  private appliedCorrection = '';
  /** Sentence the current suggestions were written for. */
  private reformulationSource = '';
  /** Accepted wording last written into the draft. */
  private acceptedReformulation = '';

  constructor() {
    effect(() => {
      this.elementId();
      this.correctTicket += 1;
      this.scoreTicket += 1;
      this.reformulateTicket += 1;
      this.draft.set('');
      this.appliedCorrection = '';
      this.dropReformulations();
      this.answerSide.set('support');
      this.hintStep.set(0);
      this.correction.set(null);
      this.coloredRules.set([]);
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
    this.correction.set(null);
    this.coloredRules.set([]);
    this.dropReformulations();
    this.error.set('');
  }

  placeholder(): string {
    const language = this.answerLanguageName();
    return language
      ? this.i18n.translate('recall.inLanguage', { language })
      : this.i18n.translate('recall.whatItMeans');
  }

  definitionCountLabel(): string {
    const count = this.senses().length;
    return count === 1
      ? this.i18n.translate('recall.definitionOne')
      : this.i18n.translate('recall.definitionMany', {
          count: count.toLocaleString(this.i18n.currentLanguage),
        });
  }

  definitionsAria(): string {
    return this.i18n.translate('recall.definitionsOf', { lemma: this.lemma() });
  }

  canCorrect(): boolean {
    return this.busy() === null && !!this.draft().trim();
  }

  canSubmit(): boolean {
    return this.busy() === null && !!this.draft().trim();
  }

  canReformulate(): boolean {
    return this.busy() === null && !!this.draft().trim() && !!this.correction();
  }

  onDraft(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.draft.set(target.value);
    if (target.value.trim() !== this.appliedCorrection.trim()) this.appliedCorrection = '';
    this.keepReformulation(target.value);
  }

  scoreLabel(scored: RecallView): string {
    const score = String(scored.coverage);
    return this.i18n.translate(scored.extra ? 'recall.scoreBonus' : 'recall.score', { score });
  }

  scoreColor(scored: RecallView): string {
    return `var(--score-${definitionScoreStep(scored.coverage)})`;
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
      this.error.set('common.saveKeyFirst');
      return;
    }
    const ticket = ++this.correctTicket;
    const elementId = this.elementId();
    const text = this.draft();
    const language = this.learningLanguage();
    const untouched =
      this.appliedCorrection !== '' && text.trim() === this.appliedCorrection.trim();
    this.busy.set('correct');
    this.error.set('');
    try {
      const prior = untouched ? [] : (await readGrammarMistakes(language)).slice(0, PRIOR_MAX);
      const names = new Map(prior.map((mistake) => [mistake.id, mistake.rule]));
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      const correction = await correctRecallAnswer({
        language,
        text,
        ...(prior.length
          ? {
              priorMistakes: prior.map((mistake) => ({
                id: mistake.id,
                rule: mistake.rule,
              })),
            }
          : {}),
      });
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      const before = text.replace(/\s+/g, ' ').trim();
      const after = correction.corrected.replace(/\s+/g, ' ').trim();
      if (!untouched && (correction.committed.length || correction.resolved.length)) {
        try {
          await applyGrammarOutcome({
            language,
            before,
            after,
            at: Date.now(),
            committed: correction.committed.map((mistake) => ({
              ...(mistake.id ? { id: mistake.id } : {}),
              rule: mistake.rule,
              wrote: mistake.wrote,
              correction: mistake.correction,
            })),
            resolved: correction.resolved.map((item) => ({ id: item.id, wrote: item.wrote })),
          });
        } catch {
          // The sentence is still shown. A later sentence can record these times.
        }
      }
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      this.draft.set(correction.corrected);
      this.correction.set(shownCorrection(correction, names));
      this.coloredRules.set([]);
      this.appliedCorrection = correction.corrected;
      this.dropReformulations();
    } catch {
      if (ticket !== this.correctTicket || this.elementId() !== elementId) return;
      this.error.set('recall.correctFailed');
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
      this.error.set('common.saveKeyFirst');
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
          this.error.set('recall.scoreFailed');
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
      this.error.set('recall.scoreFailed');
    } finally {
      if (ticket === this.scoreTicket && this.busy() === 'score') this.busy.set(null);
    }
  }

  async reformulate(): Promise<void> {
    if (!this.canReformulate() || !this.correctsGrammar()) return;
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('common.saveKeyFirst');
      return;
    }
    const ticket = ++this.reformulateTicket;
    const elementId = this.elementId();
    const text = this.draft();
    const language = this.learningLanguage();
    const lemma = this.lemma();
    this.busy.set('reformulate');
    this.error.set('');
    this.reformulationSaved.set(false);
    try {
      const offer = await suggestReformulations({ language, text, lemma });
      if (ticket !== this.reformulateTicket || this.elementId() !== elementId) return;
      this.reformulationSource = offer.source;
      this.acceptedReformulation = '';
      this.reformulations.set(
        offer.suggestions.map((item) => ({
          id: crypto.randomUUID(),
          text: item.text,
          changes: item.changes,
        })),
      );
    } catch {
      if (ticket !== this.reformulateTicket || this.elementId() !== elementId) return;
      this.error.set('recall.reformulateFailed');
    } finally {
      if (ticket === this.reformulateTicket && this.busy() === 'reformulate') this.busy.set(null);
    }
  }

  dismissReformulation(id: string): void {
    if (this.busy() !== null) return;
    const next = (this.reformulations() ?? []).filter((item) => item.id !== id);
    if (next.length) {
      this.reformulations.set(next);
      return;
    }
    this.reformulations.set(null);
    this.reformulationSource = '';
  }

  async acceptReformulation(id: string): Promise<void> {
    const item = this.reformulations()?.find((suggestion) => suggestion.id === id);
    const source = this.reformulationSource;
    if (!item || !source || this.busy() !== null) return;
    const ticket = this.reformulateTicket;
    const elementId = this.elementId();
    this.busy.set('reformulate');
    this.error.set('');
    try {
      const saved = await saveReformulation({
        language: this.learningLanguage(),
        elementId,
        source,
        text: item.text,
        changes: item.changes,
        at: Date.now(),
      });
      if (ticket !== this.reformulateTicket || this.elementId() !== elementId) return;
      if (!saved) {
        this.error.set('recall.reformulateFailed');
        return;
      }
      this.acceptedReformulation = saved.text;
      this.reformulationSource = '';
      this.reformulations.set(null);
      this.reformulationSaved.set(true);
      this.appliedCorrection = '';
      this.draft.set(saved.text);
    } catch {
      if (ticket !== this.reformulateTicket || this.elementId() !== elementId) return;
      this.error.set('recall.reformulateFailed');
    } finally {
      if (ticket === this.reformulateTicket && this.busy() === 'reformulate') this.busy.set(null);
    }
  }

  reformulationParts(item: ShownReformulation): ReformulationMark[] {
    return reformulationMarks(item.text, item.changes);
  }

  correctionParts(): GrammarMark[] {
    const found = this.correction();
    if (!found) return [];
    const selected = new Set(this.coloredRules());
    return grammarCorrectionMarks(
      found.after,
      found.rules
        .filter((rule) => selected.has(rule.key))
        .map((rule) => ({
          instances: rule.instances,
          colored: true,
          followed: rule.outcome === 'resolved',
        })),
    );
  }

  ruleColored(key: string): boolean {
    return this.coloredRules().includes(key);
  }

  toggleRuleColor(key: string): void {
    const current = this.coloredRules();
    this.coloredRules.set(
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  ruleLabel(rule: CorrectionRule): string {
    const key = rule.outcome === 'committed' ? 'recall.errorCommitted' : 'recall.corrected';
    return this.i18n.translate(key, { rule: rule.rule });
  }

  private dropReformulations(): void {
    this.reformulations.set(null);
    this.reformulationSaved.set(false);
    this.reformulationSource = '';
    this.acceptedReformulation = '';
  }

  private keepReformulation(text: string): void {
    if (!this.reformulations() && !this.reformulationSaved()) return;
    const sentence = text.replace(/\s+/g, ' ').trim();
    if (sentence === this.reformulationSource) return;
    if (this.acceptedReformulation && sentence === this.acceptedReformulation) return;
    this.dropReformulations();
  }
}

function shownCorrection(
  correction: RecallCorrection,
  names: ReadonlyMap<string, string>,
): ShownCorrection {
  const rules: CorrectionRule[] = [];
  const seen = new Set<string>();
  for (const item of correction.committed) {
    const key = item.id || item.rule.trim().toLowerCase();
    const wrote = item.wrote.trim();
    const fix = item.correction.trim();
    const instance =
      wrote && fix && wrote.toLowerCase() !== fix.toLowerCase() ? { wrote, correction: fix } : null;
    const current = rules.find((rule) => rule.key === key);
    if (current) {
      if (
        instance &&
        !current.instances.some(
          (row) => row.wrote === instance.wrote && row.correction === instance.correction,
        )
      ) {
        current.instances.push(instance);
      }
      continue;
    }
    seen.add(key);
    if (item.id) seen.add(item.id);
    rules.push({
      key,
      rule: item.rule,
      outcome: 'committed',
      instances: instance ? [instance] : [],
    });
  }
  for (const item of correction.resolved) {
    if (seen.has(item.id)) continue;
    const rule = names.get(item.id);
    if (!rule) continue;
    const wrote = item.wrote.trim();
    rules.push({
      key: item.id,
      rule,
      outcome: 'resolved',
      instances: wrote ? [{ wrote, correction: wrote }] : [],
    });
  }
  return { after: correction.corrected, rules };
}
