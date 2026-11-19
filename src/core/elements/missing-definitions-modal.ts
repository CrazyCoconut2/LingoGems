import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import {
  displayTitle,
  parsePassage,
  type ElementDefinition,
  type ParsedPassage,
} from 'collection';
import {
  MAX_MISSING_DEFINITIONS_INSTRUCTION,
  generateDefinitions,
  readStoredAiCredentials,
  type GeneratedDefinition,
} from 'ai';
import { readFieldColor } from './metadata-colors';
import { supportLanguageFor } from '../languages/translation-language';

function senseGloss(text: string): string {
  return parsePassage(text).text.trim().toLowerCase();
}

@Component({
  selector: 'app-missing-definitions-modal',
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Missing definitions"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header class="head">
          <div>
            <h2>Missing definitions</h2>
            @if (label(title()); as name) {
              <p class="learning">{{ name }}</p>
            }
            <p>Senses to add. A note narrows the batch.</p>
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
                  placeholder="Colloquial meanings"
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
                    [disabled]="busy() || saving()"
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
            <button
              type="button"
              class="discover-main"
              [disabled]="!title().trim() || busy() || saving()"
              [attr.aria-busy]="busy() ? true : null"
              (click)="submit()"
            >
              {{ proposals().length ? 'More' : 'Search' }}
            </button>
          </div>

          <div class="results">
            @if (saveError() || error()) {
              <p class="error">{{ saveError() || error() }}</p>
            } @else if (notice()) {
              <p class="notice">{{ notice() }}</p>
            }

            @if (proposals().length) {
              <div class="card-scroll">
                <div class="card-list">
                  @for (row of proposals(); track glossKey(row.text)) {
                    @let passage = sensePassage(row);
                    <article class="card" [class.collected]="saved(row)">
                      <div class="sense-main">
                        <div class="sense-copy">
                          <div class="spoken-copy">
                            @if (passage.text) {
                              <p class="passage">{{ passage.text }}</p>
                            }
                            @let translations = shownTranslations(passage);
                            @if (translations.length) {
                              <ul class="equivalents">
                                @for (translation of translations; track $index) {
                                  <li>{{ translation.text }}</li>
                                }
                              </ul>
                            }
                          </div>
                          @if (examplePassage(row); as example) {
                            <div class="sense-example">
                              @if (example.text) {
                                <p class="sense-example-text">{{ example.text }}</p>
                              }
                              @let exampleTranslations = shownTranslations(example);
                              @if (exampleTranslations.length) {
                                <ul class="equivalents">
                                  @for (translation of exampleTranslations; track $index) {
                                    <li>{{ translation.text }}</li>
                                  }
                                </ul>
                              }
                            </div>
                          }
                          @let meta = senseMeta(row);
                          @if (row.equivalent || meta.length) {
                            <ul class="sense-meta">
                              @if (row.equivalent) {
                                <li class="sense-equivalent">
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m5 8 6 6" />
                                    <path d="m4 14 6-6 2-3" />
                                    <path d="M2 5h12" />
                                    <path d="M7 2h1" />
                                    <path d="m22 22-5-10-5 10" />
                                    <path d="M14 18h6" />
                                  </svg>
                                  <span>{{ row.equivalent }}</span>
                                </li>
                              }
                              @for (entry of meta; track entry.key) {
                                <li [class.colored]="entry.color" [style.--meta-color]="entry.color">
                                  <span class="sense-meta-key">{{ metaLabel(entry.key) }}</span>
                                  <span class="sense-meta-value">{{ metaLabel(entry.value) }}</span>
                                </li>
                              }
                            </ul>
                          }
                        </div>
                        @if (saved(row)) {
                          <span class="tile-mark" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </span>
                        } @else {
                          <button
                            type="button"
                            class="tile-add"
                            aria-label="Add"
                            title="Add"
                            [disabled]="busy() || saving()"
                            (click)="addSense(row)"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M5 12h14" />
                              <path d="M12 5v14" />
                            </svg>
                          </button>
                        }
                      </div>
                    </article>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: block;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: auto;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
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
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .head {
      display: flex;
      flex-shrink: 0;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }

    .head p.learning {
      margin: 0.2rem 0 0;
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 650;
      line-height: 1.2;
    }

    .head p,
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
      width: 1.8rem;
      height: 1.8rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover {
      background: rgba(139, 144, 165, 0.16);
      color: var(--text);
    }

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

    .body {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: hidden;
      padding: 0.85rem 1.15rem 1rem;
    }

    .query {
      display: flex;
      flex-shrink: 0;
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

    .note span {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .discover-main {
      display: flex;
      flex: none;
      align-items: center;
      align-self: flex-end;
      justify-content: center;
      border: 0;
      border-radius: 0.75rem;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      color: white;
      font: inherit;
      font-weight: 650;
      padding: 0.65rem 1rem;
      font-size: 0.875rem;
      line-height: 1.1;
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
      cursor: pointer;
    }

    .discover-main:hover:not(:disabled) {
      opacity: 0.95;
    }

    .discover-main:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .instruction-field {
      position: relative;
    }

    .instruction {
      box-sizing: border-box;
      width: 100%;
      height: 2.4rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      background: var(--bg);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      padding: 0.65rem 0.85rem;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
    }

    .instruction.has-clear {
      padding-right: 2.15rem;
    }

    .instruction[readonly] {
      cursor: default;
    }

    .instruction:focus {
      outline: none;
      border-color: rgba(255, 51, 102, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 51, 102, 0.35);
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

    .clear-x:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .results {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: hidden;
    }

    .card-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .card-list {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .card {
      box-sizing: border-box;
      min-width: 0;
      margin: 0;
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: 1rem;
      background: var(--surface);
      color: var(--text);
    }

    .card.collected {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      box-shadow: 0 0 16px -2px color-mix(in srgb, var(--accent) 45%, transparent);
    }

    .sense-main {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .sense-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }

    .spoken-copy {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }

    .passage {
      margin: 0;
      color: #f1f5f9;
      font-size: 0.95rem;
      font-weight: 500;
      line-height: 1.625;
      white-space: pre-wrap;
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: #94a3b8;
      font-size: 0.75rem;
      font-style: italic;
      line-height: 1.4;
    }

    .equivalents li {
      margin: 0;
    }

    .sense-example {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
      padding: 0.65rem 0.75rem;
      border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--surface-2) 90%, transparent);
    }

    .sense-example-text {
      margin: 0;
      color: #e2e8f0;
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.5;
    }

    .sense-meta li.sense-equivalent {
      gap: 0.35rem;
      max-width: 100%;
      border-radius: 999px;
      border-color: var(--accent-border);
      background: var(--accent-soft);
      color: var(--text);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .sense-meta li.sense-equivalent svg {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      fill: none;
      stroke: var(--accent-text);
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tile-add,
    .tile-mark {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.55rem;
      height: 1.55rem;
      margin-top: 0.05rem;
      color: var(--accent-text);
    }

    .tile-add {
      border: 0;
      border-radius: 999px;
      padding: 0;
      background: rgba(var(--accent-rgb), 0.16);
      font: inherit;
      cursor: pointer;
    }

    .tile-add:disabled {
      cursor: not-allowed;
      opacity: 0.45;
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

    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 0.5rem;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.6875rem;
      line-height: 1.2;
    }

    .sense-meta-key {
      color: #94a3b8;
      font-weight: 500;
      letter-spacing: 0.02em;
    }

    .sense-meta-value {
      color: var(--text);
      font-size: inherit;
      font-weight: 600;
    }

    .sense-meta li.colored .sense-meta-value {
      color: var(--meta-color);
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
    }
  `,
})
export class MissingDefinitionsModal {
  readonly language = input.required<string>();
  readonly title = input.required<string>();
  readonly definitions = input.required<readonly ElementDefinition[]>();
  readonly saving = input(false);
  readonly saveError = input('');
  readonly closed = output<void>();
  readonly add = output<GeneratedDefinition>();

  readonly instructionMax = MAX_MISSING_DEFINITIONS_INSTRUCTION;
  readonly instruction = signal('');
  readonly proposals = signal<GeneratedDefinition[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly savedGlosses = computed(() => {
    const keys = new Set<string>();
    for (const definition of this.definitions()) {
      const key = senseGloss(definition.text);
      if (key) keys.add(key);
    }
    return keys;
  });

  private job = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.job += 1;
    });
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  locked(): boolean {
    return this.proposals().length > 0;
  }

  canClear(): boolean {
    return this.instruction().trim().length > 0 || this.proposals().length > 0;
  }

  onInstruction(event: Event): void {
    if (this.locked()) return;
    this.instruction.set((event.target as HTMLInputElement).value);
  }

  label(title: string): string {
    return displayTitle(title, this.language());
  }

  glossKey(text: string): string {
    return senseGloss(text);
  }

  saved(sense: GeneratedDefinition): boolean {
    const key = senseGloss(sense.text);
    return !!key && this.savedGlosses().has(key);
  }

  sensePassage(sense: GeneratedDefinition): ParsedPassage {
    const passage = parsePassage(sense.text);
    return { ...passage, text: displayTitle(passage.text, this.language()) };
  }

  examplePassage(sense: GeneratedDefinition): ParsedPassage | null {
    const raw = sense.example?.trim() ?? '';
    if (!raw) return null;
    const passage = parsePassage(raw);
    const text = displayTitle(passage.text, this.language());
    if (!text && !this.shownTranslations(passage).length) return null;
    return { ...passage, text };
  }

  senseMeta(sense: GeneratedDefinition): { key: string; value: string; color: string | null }[] {
    return Object.entries(sense.metadata).map(([key, value]) => ({
      key,
      value,
      color: readFieldColor('definitions', key),
    }));
  }

  metaLabel(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }

  shownTranslations(passage: ParsedPassage): ParsedPassage['translations'] {
    const target = supportLanguageFor(this.language());
    if (!target) return [];
    return passage.translations.filter((item) => item.language === target);
  }

  clearSearch(): void {
    if (this.busy() || this.saving()) return;
    this.job += 1;
    this.instruction.set('');
    this.proposals.set([]);
    this.error.set('');
    this.notice.set('');
  }

  submit(): void {
    if (this.busy() || this.saving() || !this.title().trim()) return;
    void this.load(this.proposals().length > 0);
  }

  addSense(sense: GeneratedDefinition): void {
    if (this.busy() || this.saving() || this.saved(sense)) return;
    this.add.emit(sense);
  }

  private async load(more: boolean): Promise<void> {
    const language = this.language().trim();
    const title = this.title().trim();
    if (!language || !title || this.busy()) return;
    const job = ++this.job;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    if (!readStoredAiCredentials().keys.length) {
      this.error.set('Save an API key first.');
      this.busy.set(false);
      return;
    }
    const saved = this.definitions().map((definition) => ({
      text: definition.text,
      metadata: definition.metadata,
    }));
    const shown = more
      ? this.proposals()
          .filter((sense) => !this.saved(sense))
          .map((sense) => ({ text: sense.text, metadata: sense.metadata }))
      : [];
    try {
      const senses = await generateDefinitions({
        language,
        title,
        translation: supportLanguageFor(language),
        instruction: this.instruction().trim(),
        existingDefinitions: [...saved, ...shown],
      });
      if (job !== this.job || this.destroyed) return;
      const taken = new Set<string>();
      for (const definition of [...saved, ...shown]) {
        const key = senseGloss(definition.text);
        if (key) taken.add(key);
      }
      const fresh = senses.filter((sense) => {
        const key = senseGloss(sense.text);
        if (!key || taken.has(key)) return false;
        taken.add(key);
        return true;
      });
      if (!fresh.length) {
        this.notice.set('No further definitions.');
        return;
      }
      this.proposals.update((current) => [...current, ...fresh]);
    } catch {
      if (job !== this.job || this.destroyed) return;
      this.error.set('Could not ask for definitions.');
    } finally {
      if (job === this.job && !this.destroyed) this.busy.set(false);
    }
  }
}
