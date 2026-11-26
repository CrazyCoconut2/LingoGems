import { Component, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AiError, AI_ERROR, addStoredAiKey, isAiProvider, type AiProviderId } from 'ai';
import { markOnboarded } from '../credentials/credentials';
import { TranslatePipe } from '../i18n/translate.pipe';

type Step = 'welcome' | 'ai';

type ProviderOption<T extends string> = {
  id: T;
  label: string;
};

const AI_PROVIDERS: ProviderOption<AiProviderId>[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
];

@Component({
  selector: 'app-onboarding',
  imports: [FormsModule, TranslatePipe],
  template: `
    <section class="screen">
      <div class="card">
        <span class="gem" [class.gem-lg]="step() === 'welcome'" aria-hidden="true"></span>
        @switch (step()) {
          @case ('welcome') {
            <div class="copy">
              <h1>LingoGems</h1>
              <p>{{ 'onboarding.tagline' | translate }}</p>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary" (click)="step.set('ai')">
                {{ 'onboarding.continue' | translate }}
              </button>
            </div>
          }
          @case ('ai') {
            <form (submit)="saveAi($event)">
              <div class="copy">
                <h1>{{ 'settings.aiProvider' | translate }}</h1>
                <p>{{ 'onboarding.aiHint' | translate }}</p>
              </div>
              <label for="ai-provider">
                {{ 'settings.provider' | translate }}
                <select
                  id="ai-provider"
                  [ngModel]="aiProvider()"
                  (ngModelChange)="selectAiProviderValue($event)"
                  name="aiProvider"
                >
                  @for (provider of aiProviders; track provider.id) {
                    <option [value]="provider.id">{{ provider.label }}</option>
                  }
                </select>
              </label>
              <label for="ai-api-key">
                {{ 'settings.apiKey' | translate }}
                <input
                  id="ai-api-key"
                  name="aiApiKey"
                  type="text"
                  autocomplete="off"
                  [ngModel]="aiApiKey()"
                  (ngModelChange)="setAiApiKey($event)"
                />
              </label>
              @if (aiError()) {
                <p class="error">{{ aiError() | translate }}</p>
              }
              <div class="actions">
                <button type="button" class="btn btn-secondary" (click)="step.set('welcome')">
                  {{ 'common.back' | translate }}
                </button>
                <button type="submit" class="btn btn-primary" [disabled]="!aiReady()">
                  {{ 'common.save' | translate }}
                </button>
              </div>
            </form>
          }
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .screen {
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .card {
      width: min(100%, 28rem);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1.25rem;
      padding: 1.25rem 1.15rem 1.15rem;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .card .gem {
      align-self: center;
    }

    .card:has(.gem-lg) {
      align-items: center;
      text-align: center;
    }

    .card > .actions {
      width: 100%;
    }

    .card > .actions .btn {
      width: 100%;
    }

    form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    .copy {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    h1 {
      margin: 0;
      font-size: 2rem;
      font-weight: 650;
      letter-spacing: -0.04em;
    }

    p {
      margin: 0;
      line-height: 1.45;
      color: var(--muted);
    }

    .error {
      color: var(--danger, #f43f5e);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.8125rem;
      font-weight: 650;
      color: var(--muted);
    }

    input,
    select {
      padding: 0.7rem 0.85rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      background: var(--bg);
      color: var(--text);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
    }

    input:focus,
    select:focus {
      outline: none;
      border-color: rgba(255, 51, 102, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 51, 102, 0.35);
    }

    .btn {
      border-radius: 0.75rem;
    }

    .btn-primary {
      border: 0;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      opacity: 0.95;
    }

    .btn-secondary {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: var(--bg);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
    }
  `,
})
export class Onboarding {
  readonly finished = output<void>();

  readonly aiProviders = AI_PROVIDERS;

  readonly step = signal<Step>('welcome');
  readonly aiProvider = signal<AiProviderId>('openai');
  readonly aiApiKey = signal('');
  readonly aiError = signal('');

  readonly aiReady = computed(() => this.aiApiKey().trim().length > 0);

  saveAi(event?: Event): void {
    event?.preventDefault();
    if (!this.persistAiKey()) return;
    this.finish();
  }

  setAiApiKey(value: string): void {
    this.aiApiKey.set(value);
    this.aiError.set('');
  }

  selectAiProviderValue(value: string): void {
    if (!isAiProvider(value)) return;
    this.aiProvider.set(value);
    this.aiError.set('');
  }

  private persistAiKey(): boolean {
    const apiKey = this.aiApiKey().trim();
    if (!apiKey) return false;
    try {
      addStoredAiKey(this.aiProvider(), apiKey);
      this.aiError.set('');
      return true;
    } catch (err) {
      const code = err instanceof AiError ? err.code : '';
      this.aiError.set(
        code === AI_ERROR.CREDENTIALS_ALREADY_CONFIGURED
          ? 'settings.keyDuplicate'
          : 'settings.keyInvalid',
      );
      return false;
    }
  }

  private finish(): void {
    markOnboarded();
    this.finished.emit();
  }
}
