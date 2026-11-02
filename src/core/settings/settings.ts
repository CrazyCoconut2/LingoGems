import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  isAiProvider,
  readStoredAiCredentials,
  writeStoredAiCredentials,
  type AiProviderId,
} from 'ai';

type ProviderOption = {
  id: AiProviderId;
  label: string;
};

const AI_PROVIDERS: ProviderOption[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
];

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <main>
      <header>
        <button type="button" class="back" (click)="back()">
          <span class="gem gem-mark" aria-hidden="true"></span>
          <span>Settings</span>
        </button>
      </header>

      <form (submit)="save($event)">
        <div class="copy">
          <h1>AI provider</h1>
          <p>The key stays on this device and is used to translate.</p>
        </div>
        <label for="settings-ai-provider">
          Provider
          <select
            id="settings-ai-provider"
            name="aiProvider"
            [ngModel]="provider()"
            (ngModelChange)="selectProvider($event)"
          >
            @for (option of providers; track option.id) {
              <option [value]="option.id">{{ option.label }}</option>
            }
          </select>
        </label>
        <label for="settings-ai-key">
          API key
          <input
            id="settings-ai-key"
            name="aiApiKey"
            type="text"
            autocomplete="off"
            [ngModel]="apiKey()"
            (ngModelChange)="setApiKey($event)"
          />
        </label>
        <div class="actions">
          @if (saved()) {
            <p class="saved">Saved.</p>
          }
          <button type="submit" class="btn btn-primary" [disabled]="!ready()">Save</button>
        </div>
      </form>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      width: min(100%, 32rem);
      min-height: 100dvh;
      box-sizing: border-box;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      padding: 1rem 1.25rem 2rem;
    }

    header {
      display: flex;
      align-items: center;
    }

    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--text);
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      cursor: pointer;
    }

    .gem-mark {
      --gem-size: 1.35rem;
    }

    form {
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
      font-size: 1.6rem;
      font-weight: 650;
      letter-spacing: -0.03em;
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
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .saved {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
  `,
})
export class Settings {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly stored = readStoredAiCredentials().keys[0];

  readonly providers = AI_PROVIDERS;
  readonly provider = signal<AiProviderId>(this.stored?.provider ?? 'openai');
  readonly apiKey = signal(this.stored?.apiKey ?? '');
  readonly saved = signal(false);
  readonly ready = computed(() => this.apiKey().trim().length > 0);
  private keyId = this.stored?.id ?? '';
  private rememberedProvider = this.stored?.provider;
  private rememberedModel = this.stored?.model ?? '';

  selectProvider(value: string): void {
    if (!isAiProvider(value)) return;
    this.provider.set(value);
    this.saved.set(false);
  }

  setApiKey(value: string): void {
    this.apiKey.set(value);
    this.saved.set(false);
  }

  save(event?: Event): void {
    event?.preventDefault();
    const apiKey = this.apiKey().trim();
    if (!apiKey) return;
    const provider = this.provider();
    const model = this.rememberedProvider === provider ? this.rememberedModel : '';
    const id = this.keyId || newKeyId();
    writeStoredAiCredentials({ keys: [{ id, provider, apiKey, model }] });
    this.keyId = id;
    this.rememberedProvider = provider;
    this.rememberedModel = model;
    this.saved.set(true);
  }

  back(): void {
    const state = this.location.getState() as { navigationId?: number } | null;
    if (state?.navigationId && state.navigationId > 1) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl('/');
  }
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
