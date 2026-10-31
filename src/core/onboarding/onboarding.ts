import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [FormsModule],
  template: `
    <section class="screen">
      <div class="card">
        <span class="gem" [class.gem-lg]="step() === 'welcome'" aria-hidden="true"></span>
        @switch (step()) {
          @case ('welcome') {
            <div class="copy">
              <h1>LingoGem</h1>
              <p>You collect meaning instead of grammar.</p>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary" (click)="step.set('ai')">Continue</button>
            </div>
          }
          @case ('ai') {
            <form (submit)="continueFromAi($event)">
              <div class="copy">
                <h1>AI provider</h1>
                <p>Add an API key. It stays on this device.</p>
              </div>
              <label for="ai-provider">
                Provider
                <select id="ai-provider" [ngModel]="aiProvider()" (ngModelChange)="selectAiProviderValue($event)" name="aiProvider">
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
                <button type="submit" class="btn btn-primary" [disabled]="!aiReady()">
                  Continue
                </button>
              </div>
            </form>
          }
          @case ('translation') {
            <form (submit)="saveTranslation($event)">
              <div class="copy">
                <h1>Translation provider</h1>
                <p>
                  This is optional. Without one, translations use your AI key. A translation key
                  stays on this device.
                </p>
              </div>
              <label for="translation-provider">
                Provider
                <select
                  id="translation-provider"
                  name="translationProvider"
                  [ngModel]="translationProvider()"
                  (ngModelChange)="selectTranslationProviderValue($event)"
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
                    [name]="field.name"
                    type="text"
                    autocomplete="off"
                    [ngModel]="translationValue(field.name)"
                    (ngModelChange)="setTranslationValue(field.name, $event)"
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
      </div>
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

  selectAiProviderValue(value: string): void {
    if (!isAiProvider(value)) return;
    this.aiProvider.set(value);
  }

  selectTranslationProviderValue(value: string): void {
    if (!isTranslationProvider(value)) return;
    this.translationProvider.set(value);
  }

  translationValue(name: TranslationField): string {
    return this.translationSecrets()[name] ?? '';
  }

  setTranslationValue(name: TranslationField, value: string): void {
    this.translationSecrets.update((current) => ({ ...current, [name]: value }));
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
