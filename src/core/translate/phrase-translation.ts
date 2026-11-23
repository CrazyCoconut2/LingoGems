import { Component, effect, input, output, signal } from '@angular/core';
import { requestPhraseTranslation } from './translation-cache';

/** A translate icon for one sentence. The result stays visible until this view is left. */
@Component({
  selector: 'app-phrase-translation',
  template: `
    @if (!shown()) {
      <button
        type="button"
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
    @if (shown()) {
      <span class="translation">
        {{ shown() }}
        @if (equivalent().trim(); as gloss) {
          <span class="equivalent">{{ gloss }}</span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: inline;
    }

    button {
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

    button:hover:not(:disabled) {
      color: var(--text);
    }

    button:disabled {
      cursor: progress;
      opacity: 0.45;
    }

    .translation {
      display: block;
      margin-top: 0.2rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-style: italic;
      font-weight: 400;
      line-height: 1.4;
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
  /** Translation already embedded on this passage. Used only when the cache has no text. */
  readonly seeded = input('');
  /** Support-language gloss shown after the unveiled translation. */
  readonly equivalent = input('');
  readonly translated = output<string>();
  readonly shown = signal('');
  readonly busy = signal(false);
  readonly failed = signal(false);

  constructor() {
    effect(() => {
      this.phrase();
      this.shown.set('');
      this.failed.set(false);
    });
  }

  async translate(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.busy() || this.shown()) return;
    const phrase = this.phrase().trim();
    const sourceLang = this.sourceLang().trim();
    const targetLang = this.targetLang().trim();
    if (!phrase || !sourceLang || !targetLang) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const text = await requestPhraseTranslation(sourceLang, targetLang, phrase, this.seeded());
      if (this.phrase().trim() !== phrase) return;
      this.shown.set(text);
      this.translated.emit(text);
    } catch {
      if (this.phrase().trim() === phrase) this.failed.set(true);
    } finally {
      if (this.phrase().trim() === phrase) this.busy.set(false);
    }
  }
}
