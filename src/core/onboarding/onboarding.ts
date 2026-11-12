import { Component, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isAiProvider, writeStoredAiCredentials, type AiProviderId } from 'ai';
import { markOnboarded } from '../credentials/credentials';

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
  imports: [FormsModule],
  template: `
    <section class="screen">
      <div class="card">
        <span class="gem" [class.gem-lg]="step() === 'welcome'" aria-hidden="true"></span>
        @switch (step()) {
          @case ('welcome') {
            <div class="copy">
              <h1>LingoGems</h1>
              <p>You collect meaning instead of grammar.</p>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary" (click)="step.set('ai')">
                Continue
              </button>
            </div>
          }
          @case ('ai') {
            <form (submit)="saveAi($event)">
              <div class="copy">
                <h1>AI provider</h1>
                <p>Add an API key. It stays on this device.</p>
              </div>
              <label for="ai-provider">
                Provider
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
                API key
                <input
                  id="ai-api-key"
                  name="aiApiKey"
                  type="text"
                  autocomplete="off"
                  [ngModel]="aiApiKey()"
                  (ngModelChange)="aiApiKey.set($event)"
                />
              </label>
              <div class="actions">
                <button type="button" class="btn btn-secondary" (click)="step.set('welcome')">
                  Back
                </button>
                <button type="submit" class="btn btn-primary" [disabled]="!aiReady()">Save</button>
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
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1.25rem;
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
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
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

  readonly aiReady = computed(() => this.aiApiKey().trim().length > 0);

  saveAi(event?: Event): void {
    event?.preventDefault();
    if (!this.persistAiKey()) return;
    this.finish();
  }

  selectAiProviderValue(value: string): void {
    if (!isAiProvider(value)) return;
    this.aiProvider.set(value);
  }

  private persistAiKey(): boolean {
    const apiKey = this.aiApiKey().trim();
    if (!apiKey) return false;
    writeStoredAiCredentials({
      keys: [{ id: newKeyId(), provider: this.aiProvider(), apiKey, model: '' }],
    });
    return true;
  }

  private finish(): void {
    markOnboarded();
    this.finished.emit();
  }
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
