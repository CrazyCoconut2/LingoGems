import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import packageJson from '../../../package.json';
import {
  isAiProvider,
  readStoredAiCredentials,
  writeStoredAiCredentials,
  type AiProviderId,
} from 'ai';
import { emptyMetadataIndexes, replaceCollection } from 'collection';
import {
  COMFORT_RATES,
  DEFAULT_COMFORT_PALETTE,
  readComfortPalette,
  resetComfortPalette,
  writeComfortColor,
  type ComfortRate,
} from '../elements/comfort-palette';
import { GemStatsJob } from '../elements/gem-stats-job';
import { LanguageAiSettings } from '../languages/language-ai-settings';
import { buildDataFile, downloadDataFile, readDataFile } from './data-file';

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
  imports: [FormsModule, LanguageAiSettings],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div>
            <h2>Settings</h2>
            <p>Provider, metadata, comfort colors, and your data.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="back()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div class="panel-body">
          <section class="settings-section" [class.expanded]="expanded() === 'provider'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'provider'"
              (click)="toggle('provider')"
            >
              <span class="section-title">
                AI provider
                <span class="section-count">{{ providerLabel() }}</span>
              </span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'provider') {
              <form class="section-body" (submit)="save($event)">
                <p class="section-hint">The key stays on this device and is used to translate.</p>
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
            }
          </section>

          <app-language-ai-settings [open]="expanded()" (opened)="expanded.set($event)" />

          <section class="settings-section" [class.expanded]="expanded() === 'comfort'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'comfort'"
              (click)="toggle('comfort')"
            >
              <span class="section-title">Comfort colors</span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'comfort') {
              <div class="section-body">
                <p class="section-hint">
                  Each score icon is colored by its comfort rate, from 1 to 10.
                </p>
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
              </div>
            }
          </section>

          <section class="settings-section" [class.expanded]="expanded() === 'data'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'data'"
              (click)="toggle('data')"
            >
              <span class="section-title">Your data</span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'data') {
              <div class="section-body">
                <input
                  #dataFile
                  class="file-input"
                  type="file"
                  accept=".gz,.json.gz,application/gzip"
                  (change)="chooseImport($event)"
                />
                <p class="section-hint">
                  A compressed file of your elements. AI settings stay on this device.
                </p>
                @if (confirm() === 'delete') {
                  <p class="section-hint">This deletes every element on this device.</p>
                  <div class="actions">
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="cancelConfirm()"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy()"
                      (click)="confirmDelete()"
                    >
                      Delete
                    </button>
                  </div>
                } @else if (confirm() === 'import') {
                  <p class="section-hint">
                    This replaces every element with {{ importName() || 'that file' }}.
                  </p>
                  <div class="actions">
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="cancelConfirm()"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="busy()"
                      (click)="confirmImport()"
                    >
                      Import
                    </button>
                  </div>
                } @else {
                  <div class="data-actions">
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="busy()"
                      (click)="download()"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="dataFile.click()"
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy()"
                      (click)="askDelete()"
                    >
                      Delete
                    </button>
                  </div>
                }
                @if (note()) {
                  <p class="saved">{{ note() }}</p>
                }
                @if (error()) {
                  <p class="data-error">{{ error() }}</p>
                }
              </div>
            }
          </section>
        </div>

        <footer class="panel-footer">
          <p class="version">v{{ version }}</p>
          <button type="button" class="done-btn" (click)="back()">Done</button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: auto;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .panel {
      box-sizing: border-box;
      width: min(520px, 100%);
      max-height: calc(100dvh - 2.5rem);
      margin-top: auto;
      margin-bottom: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }

    .panel-header,
    .panel-footer {
      display: flex;
      flex-shrink: 0;
    }

    .panel-header {
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
    }

    h2,
    p {
      margin: 0;
    }

    h2 {
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .panel-header p,
    .section-hint {
      margin-top: 0.4rem;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .section-hint {
      margin-top: 0;
      font-size: 0.78rem;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.15rem;
      height: 2.15rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.1);
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover {
      background: rgba(127, 127, 127, 0.18);
      color: var(--text);
    }

    .icon-btn svg,
    .section-chevron {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .panel-body {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      overflow: auto;
      padding: 0 1.15rem 1.15rem;
    }

    .settings-section {
      flex-shrink: 0;
      overflow: hidden;
      border-radius: 0.9rem;
      background: color-mix(in srgb, var(--surface) 70%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      padding: 0.85rem;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .section-title {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
      min-width: 0;
      font-size: 0.92rem;
      font-weight: 700;
    }

    .section-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 0.35rem;
      border-radius: 999px;
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
      font-size: 0.68rem;
      font-weight: 750;
    }

    .section-chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.18s ease;
    }

    .settings-section.expanded .section-chevron {
      transform: rotate(180deg);
    }

    .section-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0 0.75rem 0.85rem;
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

    .data-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .btn-danger {
      background: var(--danger);
      color: white;
    }

    .btn-danger:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    .data-error {
      margin: 0;
      color: var(--danger);
      font-size: 0.84rem;
    }

    .file-input {
      position: fixed;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
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

    .panel-footer {
      align-items: center;
      justify-content: space-between;
      padding: 0.85rem 1.15rem 1.15rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    }

    .version {
      color: var(--text-muted);
      font-size: 0.68rem;
      line-height: 1.2;
    }

    .done-btn {
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-size: 0.88rem;
      font-weight: 700;
      padding: 0.65rem 1.25rem;
      cursor: pointer;
    }

    .done-btn:hover {
      filter: brightness(1.06);
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .panel {
        width: 100%;
        max-height: calc(100dvh - 1.3rem);
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class Settings {
  readonly version = packageJson.version;
  readonly closed = output<void>();
  readonly changed = output<void>();
  readonly expanded = signal<string | null>(null);
  private readonly stored = readStoredAiCredentials().keys[0];
  private readonly job = inject(GemStatsJob);
  private importFile: File | null = null;

  readonly providers = AI_PROVIDERS;
  readonly comfortRates = COMFORT_RATES;
  readonly provider = signal<AiProviderId>(this.stored?.provider ?? 'openai');
  readonly apiKey = signal(this.stored?.apiKey ?? '');
  readonly saved = signal(false);
  readonly ready = computed(() => this.apiKey().trim().length > 0);
  readonly busy = signal(false);
  readonly confirm = signal<'delete' | 'import' | null>(null);
  readonly importName = signal('');
  readonly note = signal('');
  readonly error = signal('');
  private keyId = this.stored?.id ?? '';
  private rememberedProvider = this.stored?.provider;
  private rememberedModel = this.stored?.model ?? '';

  providerLabel(): string {
    return this.providers.find((option) => option.id === this.provider())?.label ?? '';
  }

  toggle(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  closeOnBackdrop(event: Event): void {
    if (event.target === event.currentTarget) this.back();
  }

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

  async download(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirm.set(null);
    this.error.set('');
    this.note.set('');
    try {
      downloadDataFile(await buildDataFile());
    } catch {
      this.error.set('Could not save a copy.');
    } finally {
      this.busy.set(false);
    }
  }

  chooseImport(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || this.busy()) return;
    this.importFile = file;
    this.importName.set(file.name);
    this.error.set('');
    this.note.set('');
    this.confirm.set('import');
  }

  askDelete(): void {
    if (this.busy()) return;
    this.error.set('');
    this.note.set('');
    this.confirm.set('delete');
  }

  cancelConfirm(): void {
    if (this.busy()) return;
    this.importFile = null;
    this.importName.set('');
    this.confirm.set(null);
  }

  async confirmImport(): Promise<void> {
    const file = this.importFile;
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.note.set('');
    try {
      const data = await readDataFile(file);
      try {
        const languages = await replaceCollection(data.elements, data.catalog);
        this.job.forget();
        for (const language of languages) this.job.invalidate(language);
        this.importFile = null;
        this.importName.set('');
        this.confirm.set(null);
        this.note.set('Imported.');
        this.changed.emit();
      } catch {
        this.error.set('Could not save your data.');
      }
    } catch {
      this.error.set('Could not read that file.');
    } finally {
      this.busy.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.note.set('');
    try {
      await replaceCollection([], emptyMetadataIndexes());
      this.job.forget();
      this.confirm.set(null);
      this.note.set('Deleted.');
      this.changed.emit();
    } catch {
      this.error.set('Could not delete your data.');
    } finally {
      this.busy.set(false);
    }
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
    this.closed.emit();
  }
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
