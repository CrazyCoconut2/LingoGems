import { Component, effect, input, output, signal } from '@angular/core';
import {
  readPhraseTranslation,
  notePhraseUnveil,
  requestDefinitionTranslation,
  requestPhraseTranslation,
} from './translation-cache';

/** A stored translation sits blurred under the phrase. The icon asks for one when none is stored. */
@Component({
  selector: 'app-phrase-translation',
  template: `
    @if (stored(); as text) {
      @if (revealed()) {
        <button type="button" class="translation shown" (click)="reveal($event)">
          {{ text }}
          @if (shownEquivalent(); as gloss) {
            <span class="equivalent">{{ gloss }}</span>
          }
        </button>
      } @else {
        <button
          type="button"
          class="translation"
          aria-label="Show translation"
          (click)="reveal($event)"
        >
          <span aria-hidden="true">{{ text }}</span>
        </button>
      }
    } @else {
      <button
        type="button"
        class="ask"
        [attr.aria-label]="busy() ? 'Translating…' : 'Translate'"
        [attr.title]="
          failed() ? 'Could not translate this.' : busy() ? 'Translating…' : 'Translate'
        "
        [attr.aria-busy]="busy() ? true : null"
        [disabled]="busy()"
        (click)="translate($event)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 8 6 6" />
          <path d="m4 14 6-6 2-3" />
          <path d="M2 5h12" />
          <path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" />
          <path d="M14 18h6" />
        </svg>
      </button>
    }
  `,
  styles: `
    :host {
      display: inline;
    }

    :host:has(.translation) {
      display: block;
    }

    button.ask {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.05em;
      height: 1.05em;
      margin: 0 0 0 0.35em;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      vertical-align: -0.09em;
      cursor: pointer;
    }

    svg {
      width: 0.9em;
      height: 0.9em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    button.ask:hover:not(:disabled) {
      color: var(--text);
    }

    button.ask:disabled {
      cursor: progress;
      opacity: 0.45;
    }

    .translation {
      display: block;
      width: 100%;
      margin: 0.2rem 0 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.75rem;
      font-style: italic;
      font-weight: 400;
      line-height: 1.4;
      text-align: left;
      filter: blur(0.55em);
      cursor: pointer;
      user-select: none;
    }

    .translation.shown {
      filter: none;
      cursor: pointer;
      user-select: text;
    }

    .equivalent {
      margin-left: 0.4em;
      color: var(--text);
      font-style: normal;
      font-weight: 600;
    }

    .equivalent::before {
      content: '·';
      margin-right: 0.4em;
      color: var(--text-muted);
      font-weight: 400;
    }
  `,
})
export class PhraseTranslation {
  readonly phrase = input.required<string>();
  readonly sourceLang = input.required<string>();
  readonly targetLang = input.required<string>();
  /** Support-language gloss shown after the unveiled translation. */
  readonly equivalent = input('');
  /** Headword. When set, this definition click also asks for the sense equivalent. */
  readonly lemma = input('');
  readonly translated = output<string>();
  /** Equivalent returned for a definition that did not already have one. */
  readonly equivalentFound = output<string>();
  readonly stored = signal('');
  readonly revealed = signal(false);
  readonly busy = signal(false);
  readonly failed = signal(false);
  private readonly foundEquivalent = signal('');

  constructor() {
    effect(() => {
      const phrase = this.phrase().trim();
      const cached =
        readPhraseTranslation(this.sourceLang(), this.targetLang(), phrase)?.text.trim() ?? '';
      this.stored.set(cached);
      this.revealed.set(false);
      this.foundEquivalent.set('');
      this.failed.set(false);
    });
  }

  reveal(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const text = this.stored().trim();
    if (!text) return;
    this.revealed.set(true);
    notePhraseUnveil(this.sourceLang(), this.targetLang(), this.phrase(), text);
  }

  shownEquivalent(): string {
    return this.equivalent().trim() || this.foundEquivalent().trim();
  }

  async translate(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.busy() || this.stored()) return;
    const phrase = this.phrase().trim();
    const sourceLang = this.sourceLang().trim();
    const targetLang = this.targetLang().trim();
    if (!phrase || !sourceLang || !targetLang) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const lemma = this.lemma().trim();
      const text = lemma
        ? await this.translateDefinition(sourceLang, targetLang, phrase, lemma)
        : await requestPhraseTranslation(sourceLang, targetLang, phrase);
      if (this.phrase().trim() !== phrase) return;
      this.stored.set(text);
      this.revealed.set(true);
      this.translated.emit(text);
    } catch {
      if (this.phrase().trim() === phrase) this.failed.set(true);
    } finally {
      if (this.phrase().trim() === phrase) this.busy.set(false);
    }
  }

  private async translateDefinition(
    sourceLang: string,
    targetLang: string,
    phrase: string,
    lemma: string,
  ): Promise<string> {
    const result = await requestDefinitionTranslation(
      sourceLang,
      targetLang,
      phrase,
      lemma,
      this.equivalent(),
    );
    const equivalent = result.equivalent.trim();
    if (equivalent) this.foundEquivalent.set(equivalent);
    if (equivalent && equivalent !== this.equivalent().trim()) {
      this.equivalentFound.emit(equivalent);
    }
    return result.translation;
  }
}
