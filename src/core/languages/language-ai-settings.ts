import { Component, effect, input, output, signal } from '@angular/core';
import {
  DEFAULT_DEFINITION_METADATA_FIELDS,
  DEFAULT_EXAMPLE_METADATA_FIELDS,
  MAX_METADATA_FIELD_KEY,
  MAX_METADATA_FIELD_PROMPT,
  MAX_METADATA_FIELDS,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  readExampleExtraFields,
  readExampleMetadataFields,
  readGenerateDefinitionTranslations,
  readGenerateExampleTranslations,
  readTranslationLanguage,
  writeTranslationLanguage,
  readStoredAiCredentials,
  recommendMetadataFields,
  resetDefinitionMetadataFields,
  resetExampleMetadataFields,
  writeDefinitionExtraFields,
  writeDefinitionMetadataFields,
  writeExampleExtraFields,
  writeExampleMetadataFields,
  writeGenerateDefinitionTranslations,
  writeGenerateExampleTranslations,
  type AiMetadataField,
} from 'ai';
import { LEARNABLE_LANGUAGES, languageDisplayName } from 'collection';

@Component({
  selector: 'app-language-ai-settings',
  template: `
    <div class="backdrop" (click)="onBackdrop($event)">
      <section
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Definition and example settings"
        (click)="$event.stopPropagation()"
      >
        <header class="sheet-head">
          <div>
            <h2>{{ languageName() || 'Language' }}</h2>
            <p>Definitions and examples for this language.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>
        <div class="sheet-body">
          <label class="translation-language">
            Translation language
            <select
              aria-label="Translation language"
              [value]="translationLanguage()"
              (change)="setTranslationLanguage($event)"
            >
              @for (code of languages; track code) {
                <option [value]="code" [selected]="code === translationLanguage()">
                  {{ languageLabel(code) }}
                </option>
              }
            </select>
          </label>
          <section class="metadata" aria-label="Definition metadata">
            <div class="section-head">
              <div class="copy">
                <h3>Definition metadata</h3>
                <p>
                  Asked when fetching definitions. The note is what the AI is told for that field.
                  Leave it empty to accept whatever fits.
                </p>
              </div>
              <button
                type="button"
                class="reset"
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
              Generate with a translation
            </label>
            <label class="translation-toggle">
              <input
                type="checkbox"
                [checked]="definitionExtraFields()"
                (change)="setDefinitionExtraFields($event)"
              />
              Let the AI add other relevant definition fields
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
            <div class="section-head">
              <div class="copy">
                <h3>Example metadata</h3>
                <p>
                  Asked when fetching examples. The note is what the AI is told for that field.
                  Leave it empty to accept whatever fits.
                </p>
              </div>
              <button
                type="button"
                class="reset"
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
              Generate with a translation
            </label>
            <label class="translation-toggle">
              <input
                type="checkbox"
                [checked]="exampleExtraFields()"
                (change)="setExampleExtraFields($event)"
              />
              Let the AI add other relevant example fields
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
        </div>
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
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .panel {
      width: min(32rem, 100%);
      max-height: calc(100dvh - 2.5rem);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }

    .sheet-head {
      display: flex;
      flex-shrink: 0;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
    }

    .sheet-head p,
    .copy p {
      margin-top: 0.35rem;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.45;
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

    .icon-btn svg {
      width: 1.1rem;
      height: 1.1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sheet-body {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      min-height: 0;
      overflow: auto;
      padding: 0.2rem 1.15rem 1.25rem;
    }

    .metadata {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }

    h3 {
      font-size: 1.05rem;
      font-weight: 700;
    }

    .reset,
    .metadata-add,
    .metadata-remove {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }

    .reset,
    .metadata-add {
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 650;
    }

    .reset {
      flex: none;
      margin-top: 0.2rem;
    }

    .reset:disabled,
    .metadata-add:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    label.translation-language {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 650;
    }

    select {
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    label.translation-toggle {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.55rem;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 650;
    }

    label.translation-toggle input {
      width: 1rem;
      height: 1rem;
      margin: 0;
      accent-color: var(--accent, #6c63ff);
    }

    input,
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

    .metadata-list,
    .metadata-suggestions {
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
      border-radius: 999px;
      font-size: 1.15rem;
      line-height: 1;
    }

    .metadata-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .metadata-add {
      align-self: flex-start;
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

    .metadata-suggestion p {
      margin-top: 0;
      font-size: 0.85rem;
    }

    .recommend-error {
      color: var(--text);
      font-size: 0.875rem;
    }
  `,
})
export class LanguageAiSettings {
  readonly languages = LEARNABLE_LANGUAGES;
  readonly languageLabel = languageDisplayName;
  readonly translationLanguage = signal('en');
  readonly language = input.required<string>();
  readonly languageName = input('');
  readonly closed = output<void>();
  readonly metadataKeyMax = MAX_METADATA_FIELD_KEY;
  readonly metadataPromptMax = MAX_METADATA_FIELD_PROMPT;
  readonly metadataFieldMax = MAX_METADATA_FIELDS;
  readonly definitionFields = signal<AiMetadataField[]>([]);
  readonly exampleFields = signal<AiMetadataField[]>([]);
  readonly generateDefinitionTranslations = signal(true);
  readonly generateExampleTranslations = signal(true);
  readonly definitionExtraFields = signal(false);
  readonly exampleExtraFields = signal(false);
  readonly recommendingDefinitions = signal(false);
  readonly recommendingExamples = signal(false);
  readonly definitionSuggestions = signal<AiMetadataField[]>([]);
  readonly exampleSuggestions = signal<AiMetadataField[]>([]);
  readonly definitionRecommendError = signal('');
  readonly exampleRecommendError = signal('');
  private definitionRecommendJob = 0;
  private exampleRecommendJob = 0;

  constructor() {
    effect(() => {
      const language = this.language();
      this.definitionFields.set(readDefinitionMetadataFields(language));
      this.exampleFields.set(readExampleMetadataFields(language));
      this.translationLanguage.set(readTranslationLanguage(language));
      this.generateDefinitionTranslations.set(readGenerateDefinitionTranslations(language));
      this.generateExampleTranslations.set(readGenerateExampleTranslations(language));
      this.definitionExtraFields.set(readDefinitionExtraFields(language));
      this.exampleExtraFields.set(readExampleExtraFields(language));
      this.definitionSuggestions.set([]);
      this.exampleSuggestions.set([]);
      this.definitionRecommendError.set('');
      this.exampleRecommendError.set('');
    });
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  definitionFieldsChanged(): boolean {
    return fieldsDiffer(this.definitionFields(), DEFAULT_DEFINITION_METADATA_FIELDS);
  }

  exampleFieldsChanged(): boolean {
    return fieldsDiffer(this.exampleFields(), DEFAULT_EXAMPLE_METADATA_FIELDS);
  }

  setTranslationLanguage(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    writeTranslationLanguage(this.language(), value);
    this.translationLanguage.set(readTranslationLanguage(this.language()));
  }

  setGenerateDefinitionTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateDefinitionTranslations.set(enabled);
    writeGenerateDefinitionTranslations(this.language(), enabled);
  }

  setGenerateExampleTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateExampleTranslations.set(enabled);
    writeGenerateExampleTranslations(this.language(), enabled);
  }

  setDefinitionExtraFields(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.definitionExtraFields.set(enabled);
    writeDefinitionExtraFields(this.language(), enabled);
  }

  setExampleExtraFields(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.exampleExtraFields.set(enabled);
    writeExampleExtraFields(this.language(), enabled);
  }

  setDefinitionField(index: number, part: 'key' | 'prompt', value: string): void {
    this.definitionFields.update((fields) => replaceField(fields, index, part, value));
    writeDefinitionMetadataFields(this.language(), this.definitionFields());
  }

  setExampleField(index: number, part: 'key' | 'prompt', value: string): void {
    this.exampleFields.update((fields) => replaceField(fields, index, part, value));
    writeExampleMetadataFields(this.language(), this.exampleFields());
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
    writeDefinitionMetadataFields(this.language(), this.definitionFields());
  }

  removeExampleField(index: number): void {
    this.exampleFields.update((fields) => fields.filter((_, item) => item !== index));
    writeExampleMetadataFields(this.language(), this.exampleFields());
  }

  resetDefinitionFields(): void {
    const language = this.language();
    resetDefinitionMetadataFields(language);
    this.definitionFields.set(readDefinitionMetadataFields(language));
  }

  resetExampleFields(): void {
    const language = this.language();
    resetExampleMetadataFields(language);
    this.exampleFields.set(readExampleMetadataFields(language));
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
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
    if (definitions) writeDefinitionMetadataFields(this.language(), source());
    else writeExampleMetadataFields(this.language(), source());
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
