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
import {
  COMFORT_RATES,
  DEFAULT_COMFORT_PALETTE,
  readComfortPalette,
  resetComfortPalette,
  writeComfortColor,
  type ComfortRate,
} from '../elements/comfort-palette';
import { storageKept as storageKeptState } from '../storage/keep-storage';

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
        <button type="button" class="back" aria-label="Back" (click)="back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>Back</span>
        </button>
        <h1>Settings</h1>
      </header>

      <form (submit)="save($event)">
        <div class="copy">
          <h2>AI provider</h2>
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

      <section class="palettes" aria-label="Comfort colors">
        <div class="copy">
          <h2>Comfort colors</h2>
          <p>Each element is colored by its comfort rate, from 1 to 10.</p>
        </div>
        <div class="comfort-colors">
          @for (rate of comfortRates; track rate) {
            <label>
              {{ rate }}
              <input
                type="color"
                [attr.aria-label]="'Comfort ' + rate + ' color'"
                [value]="comfortSwatch(rate)"
                (input)="setComfortColor(rate, $event)"
              />
            </label>
          }
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="!paletteChanged()"
            (click)="resetPalette()"
          >
            Reset colors
          </button>
        </div>
      </section>

      <section class="storage" aria-label="Device storage">
        <div class="copy">
          <h2>On this device</h2>
          @if (storageKept() === true) {
            <p>Languages and keys stay on this device.</p>
          } @else if (storageKept() === false) {
            <p>Languages and keys are in temporary storage until this browser locks them.</p>
          } @else {
            <p>Checking whether this browser will keep your languages and keys.</p>
          }
        </div>
      </section>
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
      gap: 0.75rem;
    }

    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      border: 0;
      padding: 0.35rem 0.55rem 0.35rem 0.2rem;
      border-radius: 999px;
      background: transparent;
      color: var(--accent-text);
      font-size: 1rem;
      font-weight: 650;
      cursor: pointer;
    }

    .back:hover {
      background: rgba(139, 144, 165, 0.16);
    }

    .back svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    header h1 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.03em;
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

    h2 {
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
      font: inherit;
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

    .palettes,
    .storage {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    .comfort-colors {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.65rem;
    }

    .comfort-colors label {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
    }

    .comfort-colors input[type='color'] {
      width: 2.4rem;
      height: 2rem;
      padding: 0.15rem;
      cursor: pointer;
    }
  `,
})
export class Settings {
  private readonly location = inject(Location);
  readonly storageKept = storageKeptState;
  private readonly router = inject(Router);
  private readonly stored = readStoredAiCredentials().keys[0];

  readonly providers = AI_PROVIDERS;
  readonly comfortRates = COMFORT_RATES;
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

  comfortSwatch(rate: ComfortRate): string {
    return readComfortPalette()[rate];
  }

  setComfortColor(rate: ComfortRate, event: Event): void {
    writeComfortColor(rate, (event.target as HTMLInputElement).value);
  }

  paletteChanged(): boolean {
    const palette = readComfortPalette();
    return this.comfortRates.some((rate) => palette[rate] !== DEFAULT_COMFORT_PALETTE[rate]);
  }

  resetPalette(): void {
    resetComfortPalette();
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
