import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  DEFAULT_DEFINITION_METADATA_FIELDS,
  DEFAULT_EXAMPLE_METADATA_FIELDS,
  MAX_METADATA_FIELD_KEY,
  MAX_METADATA_FIELD_PROMPT,
  MAX_METADATA_FIELDS,
  isAiProvider,
  readDefinitionMetadataFields,
  readExampleMetadataFields,
  readGenerateDefinitionTranslations,
  readGenerateExampleTranslations,
  readStoredAiCredentials,
  recommendMetadataFields,
  resetDefinitionMetadataFields,
  resetExampleMetadataFields,
  writeDefinitionMetadataFields,
  writeExampleMetadataFields,
  writeGenerateDefinitionTranslations,
  writeGenerateExampleTranslations,
  writeStoredAiCredentials,
  type AiMetadataField,
  type AiProviderId,
} from 'ai';
import {
  comfortColorHex,
  readScoreColorOverrides,
  resetScoreColors,
  writeScoreColor,
} from 'collection';
import { ScoreGauge } from '../elements/score-gauge';

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
  imports: [FormsModule, ScoreGauge],
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

      <section class="metadata" aria-label="Definition metadata">
        <div class="score-head">
          <div class="copy">
            <h2>Definition metadata</h2>
            <p>
              Asked when fetching definitions. The note is what the AI is told for that field. Leave
              it empty to accept whatever fits.
            </p>
          </div>
          <button
            type="button"
            class="score-reset"
            [disabled]="!definitionFieldsChanged()"
            (click)="resetDefinitionFields()"
          >
            Reset
          </button>
        </div>
        <label class="translation-toggle">
          <input
            type="checkbox"
            [checked]="generateDefinitionTranslations()"
            (change)="setGenerateDefinitionTranslations($event)"
          />
          Generate with an English translation
        </label>
        @if (definitionFields().length) {
          <ul class="metadata-list">
            @for (field of definitionFields(); track $index) {
              <li class="metadata-field">
                <div class="metadata-key-row">
                  <input
                    [attr.aria-label]="'Definition metadata key ' + ($index + 1)"
                    [attr.maxlength]="metadataKeyMax"
                    placeholder="Key"
                    [value]="field.key"
                    (input)="setDefinitionField($index, 'key', inputValue($event))"
                  />
                  <button
                    type="button"
                    class="metadata-remove"
                    [attr.aria-label]="'Remove definition metadata ' + ($index + 1)"
                    (click)="removeDefinitionField($index)"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  [attr.aria-label]="'Note for definition metadata ' + ($index + 1)"
                  [attr.maxlength]="metadataPromptMax"
                  placeholder="Whatever fits"
                  rows="2"
                  [value]="field.prompt"
                  (input)="setDefinitionField($index, 'prompt', inputValue($event))"
                ></textarea>
              </li>
            }
          </ul>
        }
        <div class="metadata-actions">
          <button
            type="button"
            class="metadata-add"
            [disabled]="definitionFields().length >= metadataFieldMax"
            (click)="addDefinitionField()"
          >
            Add field
          </button>
          <button
            type="button"
            class="metadata-add"
            [disabled]="recommendingDefinitions()"
            [attr.aria-busy]="recommendingDefinitions() ? true : null"
            (click)="recommendDefinitions()"
          >
            Recommend
          </button>
        </div>
        @if (definitionRecommendError()) {
          <p class="recommend-error">{{ definitionRecommendError() }}</p>
        }
        @let definitionPicks = openSuggestions(definitionSuggestions(), definitionFields());
        @if (definitionPicks.length) {
          <ul class="metadata-suggestions">
            @for (field of definitionPicks; track field.key) {
              <li class="metadata-suggestion">
                <div>
                  <strong>{{ field.key }}</strong>
                  <p>{{ field.prompt || 'Whatever fits' }}</p>
                </div>
                <button
                  type="button"
                  class="metadata-add"
                  [disabled]="!canAccept(definitionFields())"
                  (click)="acceptDefinitionSuggestion(field)"
                >
                  Add
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="metadata" aria-label="Example metadata">
        <div class="score-head">
          <div class="copy">
            <h2>Example metadata</h2>
            <p>
              Asked when fetching examples. The note is what the AI is told for that field. Leave it
              empty to accept whatever fits.
            </p>
          </div>
          <button
            type="button"
            class="score-reset"
            [disabled]="!exampleFieldsChanged()"
            (click)="resetExampleFields()"
          >
            Reset
          </button>
        </div>
        <label class="translation-toggle">
          <input
            type="checkbox"
            [checked]="generateExampleTranslations()"
            (change)="setGenerateExampleTranslations($event)"
          />
          Generate with an English translation
        </label>
        @if (exampleFields().length) {
          <ul class="metadata-list">
            @for (field of exampleFields(); track $index) {
              <li class="metadata-field">
                <div class="metadata-key-row">
                  <input
                    [attr.aria-label]="'Example metadata key ' + ($index + 1)"
                    [attr.maxlength]="metadataKeyMax"
                    placeholder="Key"
                    [value]="field.key"
                    (input)="setExampleField($index, 'key', inputValue($event))"
                  />
                  <button
                    type="button"
                    class="metadata-remove"
                    [attr.aria-label]="'Remove example metadata ' + ($index + 1)"
                    (click)="removeExampleField($index)"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  [attr.aria-label]="'Note for example metadata ' + ($index + 1)"
                  [attr.maxlength]="metadataPromptMax"
                  placeholder="Whatever fits"
                  rows="2"
                  [value]="field.prompt"
                  (input)="setExampleField($index, 'prompt', inputValue($event))"
                ></textarea>
              </li>
            }
          </ul>
        }
        <div class="metadata-actions">
          <button
            type="button"
            class="metadata-add"
            [disabled]="exampleFields().length >= metadataFieldMax"
            (click)="addExampleField()"
          >
            Add field
          </button>
          <button
            type="button"
            class="metadata-add"
            [disabled]="recommendingExamples()"
            [attr.aria-busy]="recommendingExamples() ? true : null"
            (click)="recommendExamples()"
          >
            Recommend
          </button>
        </div>
        @if (exampleRecommendError()) {
          <p class="recommend-error">{{ exampleRecommendError() }}</p>
        }
        @let examplePicks = openSuggestions(exampleSuggestions(), exampleFields());
        @if (examplePicks.length) {
          <ul class="metadata-suggestions">
            @for (field of examplePicks; track field.key) {
              <li class="metadata-suggestion">
                <div>
                  <strong>{{ field.key }}</strong>
                  <p>{{ field.prompt || 'Whatever fits' }}</p>
                </div>
                <button
                  type="button"
                  class="metadata-add"
                  [disabled]="!canAccept(exampleFields())"
                  (click)="acceptExampleSuggestion(field)"
                >
                  Add
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="score-colors" aria-label="Score colors">
        <div class="score-head">
          <div class="copy">
            <h2>Score colors</h2>
            <p>Each score uses this color on its gauge.</p>
          </div>
          <button
            type="button"
            class="score-reset"
            [disabled]="!colorsChanged()"
            (click)="resetAllScoreColors()"
          >
            Reset
          </button>
        </div>
        <ul class="score-grid">
          @for (level of scoreLevels; track level) {
            <li>
              <label class="score-tile" [class.changed]="overridden(level)">
                <app-score-gauge [score]="level" [color]="colorFor(level)" />
                <span class="score-label">{{ level }}</span>
                <input
                  type="color"
                  [attr.aria-label]="'Color for score ' + level"
                  [value]="colorFor(level)"
                  (input)="setScoreColor(level, inputValue($event))"
                />
              </label>
            </li>
          }
        </ul>
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
    select,
    textarea {
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 4.5rem;
      resize: vertical;
    }

    .metadata {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    label.translation-toggle {
      flex-direction: row;
      align-items: center;
      gap: 0.55rem;
      color: var(--text);
      font-size: 0.9rem;
    }

    label.translation-toggle input {
      width: 1rem;
      height: 1rem;
      margin: 0;
      padding: 0;
      accent-color: var(--accent, #6c63ff);
    }

    .metadata-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .metadata-field {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .metadata-key-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .metadata-key-row input {
      flex: 1;
      min-width: 0;
    }

    .metadata-remove {
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 1.15rem;
      line-height: 1;
      cursor: pointer;
    }

    .metadata-add {
      align-self: flex-start;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 650;
      cursor: pointer;
    }

    .metadata-add:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .metadata-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .metadata-suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .metadata-suggestion {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.7rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }

    .metadata-suggestion div {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
    }

    .metadata-suggestion strong {
      font-size: 0.9rem;
    }

    .metadata-suggestion p {
      font-size: 0.85rem;
    }

    .metadata-suggestion .metadata-add {
      flex: none;
      margin-top: 0.1rem;
    }

    .recommend-error {
      color: var(--text);
      font-size: 0.875rem;
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

    .score-colors {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    .score-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }

    .score-reset {
      flex: none;
      margin-top: 0.2rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 650;
      cursor: pointer;
    }

    .score-reset:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .score-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      padding: 0.55rem 0.25rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
    }

    .score-tile.changed {
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .score-label {
      line-height: 1;
    }

    .score-tile input[type='color'] {
      width: 1.35rem;
      height: 1.35rem;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: transparent;
      cursor: pointer;
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
  readonly scoreLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly scoreColors = signal(readScoreColorOverrides());
  readonly metadataKeyMax = MAX_METADATA_FIELD_KEY;
  readonly metadataPromptMax = MAX_METADATA_FIELD_PROMPT;
  readonly metadataFieldMax = MAX_METADATA_FIELDS;
  readonly definitionFields = signal<AiMetadataField[]>(readDefinitionMetadataFields());
  readonly exampleFields = signal<AiMetadataField[]>(readExampleMetadataFields());
  readonly generateDefinitionTranslations = signal(readGenerateDefinitionTranslations());
  readonly generateExampleTranslations = signal(readGenerateExampleTranslations());
  readonly recommendingDefinitions = signal(false);
  readonly recommendingExamples = signal(false);
  readonly definitionSuggestions = signal<AiMetadataField[]>([]);
  readonly exampleSuggestions = signal<AiMetadataField[]>([]);
  readonly definitionRecommendError = signal('');
  readonly exampleRecommendError = signal('');
  private definitionRecommendJob = 0;
  private exampleRecommendJob = 0;
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

  setGenerateDefinitionTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateDefinitionTranslations.set(enabled);
    writeGenerateDefinitionTranslations(enabled);
  }

  setGenerateExampleTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateExampleTranslations.set(enabled);
    writeGenerateExampleTranslations(enabled);
  }

  definitionFieldsChanged(): boolean {
    return fieldsDiffer(this.definitionFields(), DEFAULT_DEFINITION_METADATA_FIELDS);
  }

  exampleFieldsChanged(): boolean {
    return fieldsDiffer(this.exampleFields(), DEFAULT_EXAMPLE_METADATA_FIELDS);
  }

  setDefinitionField(index: number, part: 'key' | 'prompt', value: string): void {
    this.definitionFields.update((fields) => replaceField(fields, index, part, value));
    writeDefinitionMetadataFields(this.definitionFields());
  }

  setExampleField(index: number, part: 'key' | 'prompt', value: string): void {
    this.exampleFields.update((fields) => replaceField(fields, index, part, value));
    writeExampleMetadataFields(this.exampleFields());
  }

  addDefinitionField(): void {
    this.definitionFields.update((fields) => appendField(fields));
  }

  addExampleField(): void {
    this.exampleFields.update((fields) => appendField(fields));
  }

  recommendDefinitions(): void {
    void this.recommend('definition');
  }

  recommendExamples(): void {
    void this.recommend('example');
  }

  openSuggestions(
    suggestions: readonly AiMetadataField[],
    fields: readonly AiMetadataField[],
  ): AiMetadataField[] {
    const taken = new Set(fields.map((field) => field.key.trim().toLowerCase()).filter(Boolean));
    return suggestions.filter((field) => !taken.has(field.key.toLowerCase()));
  }

  canAccept(fields: readonly AiMetadataField[]): boolean {
    return fields.length < MAX_METADATA_FIELDS || fields.some((field) => !field.key.trim());
  }

  acceptDefinitionSuggestion(field: AiMetadataField): void {
    this.acceptSuggestion('definition', field);
  }

  acceptExampleSuggestion(field: AiMetadataField): void {
    this.acceptSuggestion('example', field);
  }

  removeDefinitionField(index: number): void {
    this.definitionFields.update((fields) => fields.filter((_, item) => item !== index));
    writeDefinitionMetadataFields(this.definitionFields());
  }

  removeExampleField(index: number): void {
    this.exampleFields.update((fields) => fields.filter((_, item) => item !== index));
    writeExampleMetadataFields(this.exampleFields());
  }

  resetDefinitionFields(): void {
    resetDefinitionMetadataFields();
    this.definitionFields.set(readDefinitionMetadataFields());
  }

  resetExampleFields(): void {
    resetExampleMetadataFields();
    this.exampleFields.set(readExampleMetadataFields());
  }

  private async recommend(kind: 'definition' | 'example'): Promise<void> {
    const definitions = kind === 'definition';
    const recommending = definitions ? this.recommendingDefinitions : this.recommendingExamples;
    const error = definitions ? this.definitionRecommendError : this.exampleRecommendError;
    const suggestions = definitions ? this.definitionSuggestions : this.exampleSuggestions;
    if (!readStoredAiCredentials().keys.length) {
      error.set('Save an API key first.');
      return;
    }
    const job = definitions ? ++this.definitionRecommendJob : ++this.exampleRecommendJob;
    recommending.set(true);
    error.set('');
    const existing = definitions ? this.definitionFields() : this.exampleFields();
    try {
      const fields = await recommendMetadataFields(kind, existing);
      if (!this.recommendCurrent(kind, job)) return;
      suggestions.set(fields);
      if (!fields.length) error.set('No further fields.');
    } catch {
      if (this.recommendCurrent(kind, job)) error.set('Could not recommend fields.');
    } finally {
      if (this.recommendCurrent(kind, job)) recommending.set(false);
    }
  }

  private acceptSuggestion(kind: 'definition' | 'example', field: AiMetadataField): void {
    const definitions = kind === 'definition';
    const source = definitions ? this.definitionFields : this.exampleFields;
    if (!this.canAccept(source())) return;
    source.update((fields) => acceptField(fields, field));
    if (definitions) writeDefinitionMetadataFields(source());
    else writeExampleMetadataFields(source());
    const suggestions = definitions ? this.definitionSuggestions : this.exampleSuggestions;
    suggestions.update((fields) =>
      fields.filter((item) => item.key.toLowerCase() !== field.key.toLowerCase()),
    );
  }

  private recommendCurrent(kind: 'definition' | 'example', job: number): boolean {
    return kind === 'definition'
      ? job === this.definitionRecommendJob
      : job === this.exampleRecommendJob;
  }

  colorFor(level: number): string {
    return this.scoreColors()[level - 1] ?? comfortColorHex(level);
  }

  overridden(level: number): boolean {
    return this.scoreColors()[level - 1] != null;
  }

  colorsChanged(): boolean {
    return this.scoreColors().some((color) => color != null);
  }

  setScoreColor(level: number, value: string): void {
    writeScoreColor(level, value);
    this.scoreColors.set(readScoreColorOverrides());
  }

  resetAllScoreColors(): void {
    resetScoreColors();
    this.scoreColors.set(readScoreColorOverrides());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
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

function fieldsDiffer(
  fields: readonly AiMetadataField[],
  defaults: readonly AiMetadataField[],
): boolean {
  if (fields.length !== defaults.length) return true;
  return fields.some(
    (field, index) =>
      field.key !== defaults[index]?.key || field.prompt !== defaults[index]?.prompt,
  );
}

function replaceField(
  fields: readonly AiMetadataField[],
  index: number,
  part: 'key' | 'prompt',
  value: string,
): AiMetadataField[] {
  return fields.map((field, item) => (item === index ? { ...field, [part]: value } : field));
}

function appendField(fields: readonly AiMetadataField[]): AiMetadataField[] {
  if (fields.length >= MAX_METADATA_FIELDS) return [...fields];
  return [...fields, { key: '', prompt: '' }];
}

function acceptField(
  fields: readonly AiMetadataField[],
  field: AiMetadataField,
): AiMetadataField[] {
  const blank = fields.findIndex((item) => !item.key.trim());
  if (blank >= 0) {
    return fields.map((item, index) =>
      index === blank ? { key: field.key, prompt: field.prompt } : item,
    );
  }
  if (fields.length >= MAX_METADATA_FIELDS) return [...fields];
  return [...fields, { key: field.key, prompt: field.prompt }];
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
