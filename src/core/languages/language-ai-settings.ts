import { Component, input, output, signal } from '@angular/core';
import {
  DEFAULT_DEFINITION_METADATA_FIELDS,
  DEFAULT_EXAMPLE_METADATA_FIELDS,
  DEFAULT_FORM_METADATA_FIELDS,
  MAX_METADATA_FIELD_KEY,
  MAX_METADATA_FIELD_PROMPT,
  MAX_METADATA_FIELDS,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  readExampleExtraFields,
  readExampleMetadataFields,
  readFormExtraFields,
  readFormMetadataFields,
  readGenerateDefinitionTranslations,
  readGenerateExampleTranslations,
  readTranslationLanguage,
  writeTranslationLanguage,
  readStoredAiCredentials,
  recommendMetadataFields,
  resetDefinitionMetadataFields,
  resetExampleMetadataFields,
  resetFormMetadataFields,
  writeDefinitionExtraFields,
  writeDefinitionMetadataFields,
  writeExampleExtraFields,
  writeExampleMetadataFields,
  writeFormExtraFields,
  writeFormMetadataFields,
  writeGenerateDefinitionTranslations,
  writeGenerateExampleTranslations,
  type AiMetadataField,
} from 'ai';
import { LEARNABLE_LANGUAGES, languageDisplayName } from 'collection';

const SETTINGS_SCOPE = 'app';


type MetadataKind = 'definition' | 'example' | 'form';

@Component({
  selector: 'app-language-ai-settings',
  standalone: true,
  template: `
    <section class="settings-section" [class.expanded]="open() === 'translation'">
      <button
        type="button"
        class="section-header"
        [attr.aria-expanded]="open() === 'translation'"
        (click)="toggle('translation')"
      >
        <span class="section-title">
          Translation language
          <span class="section-count">{{ languageLabel(translationLanguage()) }}</span>
        </span>
        <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      @if (open() === 'translation') {
        <div class="section-body">
          <p class="section-hint">Translations are written in this language.</p>
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
        </div>
      }
    </section>
    <section class="settings-section" [class.expanded]="open() === 'definitions'">
      <button
        type="button"
        class="section-header"
        [attr.aria-expanded]="open() === 'definitions'"
        (click)="toggle('definitions')"
      >
        <span class="section-title">
          Definition metadata
          @if (filledCount(definitionFields()); as count) {
            <span class="section-count">{{ count }}</span>
          }
        </span>
        <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      @if (open() === 'definitions') {
        <div class="section-body metadata">
            <div class="section-head">
              <p class="section-hint">
                Asked when fetching definitions. The note is what the AI is told for that field.
                Leave it empty to accept whatever fits.
              </p>
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
        </div>
      }
    </section>

    <section class="settings-section" [class.expanded]="open() === 'examples'">
      <button
        type="button"
        class="section-header"
        [attr.aria-expanded]="open() === 'examples'"
        (click)="toggle('examples')"
      >
        <span class="section-title">
          Example metadata
          @if (filledCount(exampleFields()); as count) {
            <span class="section-count">{{ count }}</span>
          }
        </span>
        <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      @if (open() === 'examples') {
        <div class="section-body metadata">
            <div class="section-head">
              <p class="section-hint">
                Asked when fetching examples. The note is what the AI is told for that field.
                Leave it empty to accept whatever fits.
              </p>
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
        </div>
      }
    </section>

    <section class="settings-section" [class.expanded]="open() === 'forms'">
      <button
        type="button"
        class="section-header"
        [attr.aria-expanded]="open() === 'forms'"
        (click)="toggle('forms')"
      >
        <span class="section-title">
          Forms metadata
          @if (filledCount(formFields()); as count) {
            <span class="section-count">{{ count }}</span>
          }
        </span>
        <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      @if (open() === 'forms') {
        <div class="section-body metadata">
          <div class="section-head">
            <p class="section-hint">
              Asked when fetching forms. The note is what the AI is told for that field. Leave it
              empty to accept whatever fits.
            </p>
            <button
              type="button"
              class="reset"
              [disabled]="!formFieldsChanged()"
              (click)="resetFormFields()"
            >
              Reset
            </button>
          </div>
          <label class="translation-toggle">
            <input
              type="checkbox"
              [checked]="formExtraFields()"
              (change)="setFormExtraFields($event)"
            />
            Let the AI add other relevant form fields
          </label>
          @if (formFields().length) {
            <ul class="metadata-list">
              @for (field of formFields(); track $index) {
                <li class="metadata-field">
                  <div class="metadata-key-row">
                    <input
                      [attr.aria-label]="'Form metadata key ' + ($index + 1)"
                      [attr.maxlength]="metadataKeyMax"
                      placeholder="Key"
                      [value]="field.key"
                      (input)="setFormField($index, 'key', inputValue($event))"
                    />
                    <button
                      type="button"
                      class="metadata-remove"
                      [attr.aria-label]="'Remove form metadata ' + ($index + 1)"
                      (click)="removeFormField($index)"
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    [attr.aria-label]="'Note for form metadata ' + ($index + 1)"
                    [attr.maxlength]="metadataPromptMax"
                    placeholder="Whatever fits"
                    rows="2"
                    [value]="field.prompt"
                    (input)="setFormField($index, 'prompt', inputValue($event))"
                  ></textarea>
                </li>
              }
            </ul>
          }
          <div class="metadata-actions">
            <button
              type="button"
              class="metadata-add"
              [disabled]="formFields().length >= metadataFieldMax"
              (click)="addFormField()"
            >
              Add field
            </button>
            <button
              type="button"
              class="metadata-add"
              [disabled]="recommendingForms()"
              [attr.aria-busy]="recommendingForms() ? true : null"
              (click)="recommendForms()"
            >
              Recommend
            </button>
          </div>
          @if (formRecommendError()) {
            <p class="recommend-error">{{ formRecommendError() }}</p>
          }
          @let formPicks = openSuggestions(formSuggestions(), formFields());
          @if (formPicks.length) {
            <ul class="metadata-suggestions">
              @for (field of formPicks; track field.key) {
                <li class="metadata-suggestion">
                  <div>
                    <strong>{{ field.key }}</strong>
                    <p>{{ field.prompt || 'Whatever fits' }}</p>
                  </div>
                  <button
                    type="button"
                    class="metadata-add"
                    [disabled]="!canAccept(formFields())"
                    (click)="acceptFormSuggestion(field)"
                  >
                    Add
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }

    p {
      margin: 0;
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
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
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

    .section-hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.78rem;
      line-height: 1.4;
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
  readonly open = input<string | null>(null);
  readonly opened = output<string | null>();
  readonly languages = LEARNABLE_LANGUAGES;
  readonly languageLabel = languageDisplayName;
  readonly translationLanguage = signal('en');
  readonly metadataKeyMax = MAX_METADATA_FIELD_KEY;
  readonly metadataPromptMax = MAX_METADATA_FIELD_PROMPT;
  readonly metadataFieldMax = MAX_METADATA_FIELDS;
  readonly definitionFields = signal<AiMetadataField[]>([]);
  readonly exampleFields = signal<AiMetadataField[]>([]);
  readonly formFields = signal<AiMetadataField[]>([]);
  readonly generateDefinitionTranslations = signal(true);
  readonly generateExampleTranslations = signal(true);
  readonly definitionExtraFields = signal(false);
  readonly exampleExtraFields = signal(false);
  readonly formExtraFields = signal(false);
  readonly recommendingDefinitions = signal(false);
  readonly recommendingExamples = signal(false);
  readonly recommendingForms = signal(false);
  readonly definitionSuggestions = signal<AiMetadataField[]>([]);
  readonly exampleSuggestions = signal<AiMetadataField[]>([]);
  readonly formSuggestions = signal<AiMetadataField[]>([]);
  readonly definitionRecommendError = signal('');
  readonly exampleRecommendError = signal('');
  readonly formRecommendError = signal('');
  private definitionRecommendJob = 0;
  private exampleRecommendJob = 0;
  private formRecommendJob = 0;

  constructor() {
    this.definitionFields.set(readDefinitionMetadataFields(SETTINGS_SCOPE));
    this.exampleFields.set(readExampleMetadataFields(SETTINGS_SCOPE));
    this.formFields.set(readFormMetadataFields(SETTINGS_SCOPE));
    this.translationLanguage.set(readTranslationLanguage(SETTINGS_SCOPE));
    this.generateDefinitionTranslations.set(readGenerateDefinitionTranslations(SETTINGS_SCOPE));
    this.generateExampleTranslations.set(readGenerateExampleTranslations(SETTINGS_SCOPE));
    this.definitionExtraFields.set(readDefinitionExtraFields(SETTINGS_SCOPE));
    this.exampleExtraFields.set(readExampleExtraFields(SETTINGS_SCOPE));
    this.formExtraFields.set(readFormExtraFields(SETTINGS_SCOPE));
  }

  toggle(id: string): void {
    this.opened.emit(this.open() === id ? null : id);
  }

  filledCount(fields: readonly AiMetadataField[]): number {
    return fields.filter((field) => field.key.trim()).length;
  }

  definitionFieldsChanged(): boolean {
    return fieldsDiffer(this.definitionFields(), DEFAULT_DEFINITION_METADATA_FIELDS);
  }

  exampleFieldsChanged(): boolean {
    return fieldsDiffer(this.exampleFields(), DEFAULT_EXAMPLE_METADATA_FIELDS);
  }

  formFieldsChanged(): boolean {
    return fieldsDiffer(this.formFields(), DEFAULT_FORM_METADATA_FIELDS);
  }

  setTranslationLanguage(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    writeTranslationLanguage(SETTINGS_SCOPE, value);
    this.translationLanguage.set(readTranslationLanguage(SETTINGS_SCOPE));
  }

  setGenerateDefinitionTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateDefinitionTranslations.set(enabled);
    writeGenerateDefinitionTranslations(SETTINGS_SCOPE, enabled);
  }

  setGenerateExampleTranslations(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.generateExampleTranslations.set(enabled);
    writeGenerateExampleTranslations(SETTINGS_SCOPE, enabled);
  }

  setDefinitionExtraFields(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.definitionExtraFields.set(enabled);
    writeDefinitionExtraFields(SETTINGS_SCOPE, enabled);
  }

  setExampleExtraFields(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.exampleExtraFields.set(enabled);
    writeExampleExtraFields(SETTINGS_SCOPE, enabled);
  }

  setFormExtraFields(event: Event): void {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    this.formExtraFields.set(enabled);
    writeFormExtraFields(SETTINGS_SCOPE, enabled);
  }

  setDefinitionField(index: number, part: 'key' | 'prompt', value: string): void {
    this.definitionFields.update((fields) => replaceField(fields, index, part, value));
    writeDefinitionMetadataFields(SETTINGS_SCOPE, this.definitionFields());
  }

  setExampleField(index: number, part: 'key' | 'prompt', value: string): void {
    this.exampleFields.update((fields) => replaceField(fields, index, part, value));
    writeExampleMetadataFields(SETTINGS_SCOPE, this.exampleFields());
  }

  setFormField(index: number, part: 'key' | 'prompt', value: string): void {
    this.formFields.update((fields) => replaceField(fields, index, part, value));
    writeFormMetadataFields(SETTINGS_SCOPE, this.formFields());
  }

  addDefinitionField(): void {
    this.definitionFields.update((fields) => appendField(fields));
  }

  addExampleField(): void {
    this.exampleFields.update((fields) => appendField(fields));
  }

  addFormField(): void {
    this.formFields.update((fields) => appendField(fields));
  }

  recommendDefinitions(): void {
    void this.recommend('definition');
  }

  recommendExamples(): void {
    void this.recommend('example');
  }

  recommendForms(): void {
    void this.recommend('form');
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

  acceptFormSuggestion(field: AiMetadataField): void {
    this.acceptSuggestion('form', field);
  }

  removeDefinitionField(index: number): void {
    this.definitionFields.update((fields) => fields.filter((_, item) => item !== index));
    writeDefinitionMetadataFields(SETTINGS_SCOPE, this.definitionFields());
  }

  removeExampleField(index: number): void {
    this.exampleFields.update((fields) => fields.filter((_, item) => item !== index));
    writeExampleMetadataFields(SETTINGS_SCOPE, this.exampleFields());
  }

  removeFormField(index: number): void {
    this.formFields.update((fields) => fields.filter((_, item) => item !== index));
    writeFormMetadataFields(SETTINGS_SCOPE, this.formFields());
  }

  resetDefinitionFields(): void {
    const language = SETTINGS_SCOPE;
    resetDefinitionMetadataFields(language);
    this.definitionFields.set(readDefinitionMetadataFields(language));
  }

  resetExampleFields(): void {
    const language = SETTINGS_SCOPE;
    resetExampleMetadataFields(language);
    this.exampleFields.set(readExampleMetadataFields(language));
  }

  resetFormFields(): void {
    const language = SETTINGS_SCOPE;
    resetFormMetadataFields(language);
    this.formFields.set(readFormMetadataFields(language));
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private async recommend(kind: MetadataKind): Promise<void> {
    const place = this.place(kind);
    if (!readStoredAiCredentials().keys.length) {
      place.error.set('Save an API key first.');
      return;
    }
    const job = place.nextJob();
    place.recommending.set(true);
    place.error.set('');
    try {
      const fields = await recommendMetadataFields(kind, place.fields());
      if (!place.current(job)) return;
      place.suggestions.set(fields);
      if (!fields.length) place.error.set('No further fields.');
    } catch {
      if (place.current(job)) place.error.set('Could not recommend fields.');
    } finally {
      if (place.current(job)) place.recommending.set(false);
    }
  }

  private acceptSuggestion(kind: MetadataKind, field: AiMetadataField): void {
    const place = this.place(kind);
    if (!this.canAccept(place.fields())) return;
    place.fields.update((fields) => acceptField(fields, field));
    place.write(place.fields());
    place.suggestions.update((fields) =>
      fields.filter((item) => item.key.toLowerCase() !== field.key.toLowerCase()),
    );
  }

  private place(kind: MetadataKind) {
    if (kind === 'definition') {
      return {
        recommending: this.recommendingDefinitions,
        error: this.definitionRecommendError,
        suggestions: this.definitionSuggestions,
        fields: this.definitionFields,
        write: (fields: readonly AiMetadataField[]) =>
          writeDefinitionMetadataFields(SETTINGS_SCOPE, fields),
        current: (job: number) => job === this.definitionRecommendJob,
        nextJob: () => ++this.definitionRecommendJob,
      };
    }
    if (kind === 'example') {
      return {
        recommending: this.recommendingExamples,
        error: this.exampleRecommendError,
        suggestions: this.exampleSuggestions,
        fields: this.exampleFields,
        write: (fields: readonly AiMetadataField[]) =>
          writeExampleMetadataFields(SETTINGS_SCOPE, fields),
        current: (job: number) => job === this.exampleRecommendJob,
        nextJob: () => ++this.exampleRecommendJob,
      };
    }
    return {
      recommending: this.recommendingForms,
      error: this.formRecommendError,
      suggestions: this.formSuggestions,
      fields: this.formFields,
      write: (fields: readonly AiMetadataField[]) => writeFormMetadataFields(SETTINGS_SCOPE, fields),
      current: (job: number) => job === this.formRecommendJob,
      nextJob: () => ++this.formRecommendJob,
    };
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
