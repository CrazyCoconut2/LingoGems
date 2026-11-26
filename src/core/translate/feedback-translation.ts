import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { readStoredAiCredentials } from 'ai';
import { LanguageService } from '../i18n/language.service';
import { readPhraseTranslation, requestPhraseTranslation } from './translation-cache';

/** Translate one learning-language comment into the support language. */
@Component({
  selector: 'app-feedback-translation',
  host: {
    '[class.ready]': 'available()',
  },
  template: `
    @if (available()) {
      <button
        type="button"
        [attr.aria-label]="label()"
        [attr.title]="label()"
        [attr.aria-pressed]="shown() ? true : null"
        [attr.aria-busy]="busy() ? true : null"
        [disabled]="busy()"
        (click)="toggle($event)"
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
      display: none;
    }

    :host.ready {
      display: inline-flex;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    button:hover:not(:disabled),
    button[aria-pressed='true'] {
      color: var(--text);
    }

    button:disabled {
      cursor: progress;
      opacity: 0.45;
    }

    svg {
      width: 0.95rem;
      height: 0.95rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class FeedbackTranslation {
  private readonly i18n = inject(LanguageService);
  readonly text = input('');
  readonly sourceLang = input('');
  readonly targetLang = input('');
  readonly shown = signal('');
  readonly busy = signal(false);
  readonly failed = signal(false);
  private readonly problem = signal('');
  private ticket = 0;

  readonly available = computed(() => {
    const text = this.text().trim();
    const source = this.sourceLang().trim().toLowerCase();
    const target = this.targetLang().trim().toLowerCase();
    return !!text && !!source && !!target && source !== target;
  });

  constructor() {
    effect(() => {
      this.text();
      this.sourceLang();
      this.targetLang();
      this.ticket += 1;
      this.shown.set('');
      this.busy.set(false);
      this.failed.set(false);
      this.problem.set('');
    });
  }

  label(): string {
    if (this.busy()) return this.i18n.translate('translate.translating');
    if (this.failed()) return this.i18n.translate(this.problem() || 'translate.failed');
    if (this.shown()) return this.i18n.translate('translate.hide');
    return this.i18n.translate('translate.translate');
  }

  async toggle(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.busy() || !this.available()) return;
    if (this.shown()) {
      this.shown.set('');
      return;
    }
    const text = this.text().trim();
    const sourceLang = this.sourceLang().trim();
    const targetLang = this.targetLang().trim();
    const ticket = ++this.ticket;
    this.failed.set(false);
    this.problem.set('');
    const cached = readPhraseTranslation(sourceLang, targetLang, text)?.text.trim() ?? '';
    if (!cached && !readStoredAiCredentials().keys.length) {
      this.failed.set(true);
      this.problem.set('common.saveKeyFirst');
      return;
    }
    if (!cached) this.busy.set(true);
    try {
      const translated = await requestPhraseTranslation(sourceLang, targetLang, text);
      if (ticket !== this.ticket || this.text().trim() !== text) return;
      this.shown.set(translated);
    } catch {
      if (ticket !== this.ticket || this.text().trim() !== text) return;
      this.failed.set(true);
      this.problem.set('translate.failed');
    } finally {
      if (ticket === this.ticket) this.busy.set(false);
    }
  }
}
