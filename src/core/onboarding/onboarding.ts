import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  isAiProvider,
  isTranslationProvider,
  markOnboarded,
  secretsForProvider,
  writeStoredAiCredentials,
  writeStoredTranslationCredentials,
  type AiProviderId,
  type StoredTranslationSecrets,
  type TranslationProviderId,
} from '../credentials/credentials';

type Step = 'welcome' | 'ai' | 'translation';

type TranslationField = keyof StoredTranslationSecrets;

type ProviderOption<T extends string> = {
  id: T;
  label: string;
};

type FieldMeta = {
  name: TranslationField;
  label: string;
};

const AI_PROVIDERS: ProviderOption<AiProviderId>[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
];

const TRANSLATION_PROVIDERS: ProviderOption<TranslationProviderId>[] = [
  { id: 'deepl', label: 'DeepL API' },
  { id: 'google', label: 'Google Cloud Translation' },
  { id: 'azure', label: 'Microsoft Azure AI Translator' },
  { id: 'amazon', label: 'Amazon Translate' },
];

const TRANSLATION_FIELDS: Record<TranslationProviderId, FieldMeta[]> = {
  deepl: [{ name: 'apiKey', label: 'API key' }],
  google: [{ name: 'apiKey', label: 'API key' }],
  azure: [
    { name: 'subscriptionKey', label: 'Subscription key' },
    { name: 'region', label: 'Region' },
  ],
  amazon: [
    { name: 'accessKeyId', label: 'Access key ID' },
    { name: 'secretAccessKey', label: 'Secret access key' },
    { name: 'region', label: 'Region' },
  ],
};

const EMPTY_SECRETS: StoredTranslationSecrets = {
  apiKey: '',
  subscriptionKey: '',
  region: '',
  accessKeyId: '',
  secretAccessKey: '',
};

@Component({
  selector: 'app-onboarding',
  template: `
    <section class="screen">
      @switch (step()) {
        @case ('welcome') {
          <div class="card">
            <h1>LingoGem</h1>
            <p>You collect meaning instead of grammar.</p>
            <div class="actions">
              <button type="button" class="btn btn-primary" (click)="step.set('ai')">Continue</button>
            </div>
          </div>
        }
        @case ('ai') {
          <form class="card" (submit)="continueFromAi($event)">
            <h1>AI provider</h1>
            <p>Add an API key. It stays on this device.</p>
            <label for="ai-provider">
              Provider
              <select id="ai-provider" [value]="aiProvider()" (change)="selectAiProvider($event)">
                @for (provider of aiProviders; track provider.id) {
                  <option [value]="provider.id">{{ provider.label }}</option>
                }
              </select>
            </label>
            <label for="ai-api-key">
              API key
              <input
                id="ai-api-key"
                type="text"
                autocomplete="off"
                [value]="aiApiKey()"
                (input)="aiApiKey.set(inputValue($event))"
              />
            </label>
            <div class="actions">
              <button type="button" class="btn btn-secondary" (click)="step.set('welcome')">
                Back
              </button>
              <button type="submit" class="btn btn-primary" [disabled]="!aiReady()">
                Continue
              </button>
            </div>
          </form>
        }
        @case ('translation') {
          <form class="card" (submit)="saveTranslation($event)">
            <h1>Translation provider</h1>
            <p>
              This is optional. Without one, translations use your AI key. A translation key stays
              on this device.
            </p>
            <label for="translation-provider">
              Provider
              <select
                id="translation-provider"
                [value]="translationProvider()"
                (change)="selectTranslationProvider($event)"
              >
                @for (provider of translationProviders; track provider.id) {
                  <option [value]="provider.id">{{ provider.label }}</option>
                }
              </select>
            </label>
            @for (field of translationFields(); track field.name) {
              <label [attr.for]="'translation-' + field.name">
                {{ field.label }}
                <input
                  [id]="'translation-' + field.name"
                  type="text"
                  autocomplete="off"
                  [value]="translationValue(field.name)"
                  (input)="setTranslationValue(field.name, inputValue($event))"
                />
              </label>
            }
            <div class="actions">
              <button type="button" class="btn btn-secondary" (click)="step.set('ai')">Back</button>
              <button type="button" class="btn btn-secondary" (click)="skipTranslation()">
                Skip
              </button>
              <button type="submit" class="btn btn-primary" [disabled]="!translationReady()">
                Save
              </button>
            </div>
          </form>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .screen {
      min-height: 100dvh;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      font-family: var(--font);
      color: var(--text);
    }

    .card {
      width: min(100%, 28rem);
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin: 0;
      padding: 1.5rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    h1 {
      margin: 0;
      font-size: 1.75rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      color: var(--text);
    }

    p {
      margin: 0;
      line-height: 1.5;
      color: var(--muted);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--muted);
    }

    input,
    select {
      font: inherit;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--text);
    }

    input:focus,
    select:focus {
      outline: 2px solid rgba(var(--accent-rgb), 0.45);
      border-color: var(--accent);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 999px;
      padding: 0.6rem 1rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }

    .btn-secondary {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `,
})
export class Onboarding {
  private readonly router = inject(Router);

  readonly aiProviders = AI_PROVIDERS;
  readonly translationProviders = TRANSLATION_PROVIDERS;

  readonly step = signal<Step>('welcome');
  readonly aiProvider = signal<AiProviderId>('openai');
  readonly aiApiKey = signal('');
  readonly translationProvider = signal<TranslationProviderId>('deepl');
  private readonly translationSecrets = signal<StoredTranslationSecrets>({ ...EMPTY_SECRETS });

  readonly translationFields = computed(() => TRANSLATION_FIELDS[this.translationProvider()]);
  readonly aiReady = computed(() => this.aiApiKey().trim().length > 0);
  readonly translationReady = computed(
    () => secretsForProvider(this.translationProvider(), this.translationSecrets()) !== null,
  );

  continueFromAi(event?: Event): void {
    event?.preventDefault();
    if (!this.aiReady()) return;
    this.step.set('translation');
  }

  selectAiProvider(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isAiProvider(value)) return;
    this.aiProvider.set(value);
  }

  selectTranslationProvider(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isTranslationProvider(value)) return;
    this.translationProvider.set(value);
  }

  translationValue(name: TranslationField): string {
    return this.translationSecrets()[name] ?? '';
  }

  setTranslationValue(name: TranslationField, value: string): void {
    this.translationSecrets.update((current) => ({ ...current, [name]: value }));
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  saveTranslation(event?: Event): void {
    event?.preventDefault();
    const secrets = secretsForProvider(this.translationProvider(), this.translationSecrets());
    if (!secrets || !this.persistAiKey()) return;
    writeStoredTranslationCredentials({
      keys: [{ id: newKeyId(), provider: this.translationProvider(), secrets }],
    });
    this.finish();
  }

  skipTranslation(): void {
    if (!this.persistAiKey()) return;
    this.finish();
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
    void this.router.navigateByUrl('/');
  }
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
