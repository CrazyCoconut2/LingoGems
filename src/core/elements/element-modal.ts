import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  assignEquivalent,
  deleteElement,
  embedTranslation,
  formTexts,
  highlightDefinitionPassage,
  isValidForm,
  parsePassage,
  saveElement,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
  type ElementDefinition,
  type ElementEquivalent,
  type ElementMetadata,
  type PassageTranslation,
  type StoredElement,
} from 'collection';
import { generateDefinitions, generateForms } from 'ai';
import { translatePhrase } from '../translate/translate';

const FORM_MAX_LENGTH = 100;
const META_KEY_MAX_LENGTH = 40;
const META_VALUE_MAX_LENGTH = 100;

type Editor =
  | { kind: 'definition'; index: number | null }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number | null };

type FormEdit = { definitionIndex: number };

type MetadataEdit = { previousKey: string | null };

function writeMetadata(
  metadata: ElementMetadata,
  previousKey: string | null,
  key: string,
  value: string,
): ElementMetadata {
  const next: ElementMetadata = {};
  let placed = false;
  for (const [currentKey, currentValue] of Object.entries(metadata)) {
    const samePrevious = previousKey != null && currentKey === previousKey;
    const sameKey = currentKey.toLowerCase() === key.toLowerCase();
    if (samePrevious || sameKey) {
      if (!placed) {
        next[key] = value;
        placed = true;
      }
      continue;
    }
    next[currentKey] = currentValue;
  }
  if (!placed) next[key] = value;
  return next;
}

type ConfirmDelete =
  | { kind: 'element' }
  | { kind: 'definition'; index: number }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number };

@Component({
  selector: 'app-element-modal',
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="element().title"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <div class="title-block">
            <h2>{{ element().title }}</h2>
            @if (headerEquivalents(); as equivalents) {
              @if (equivalents.length) {
                <ul class="equivalents">
                  @for (equivalent of equivalents; track equivalent) {
                    <li>{{ equivalent }}</li>
                  }
                </ul>
              }
            }
          </div>
          <div class="header-actions">
            <button
              #closeButton
              type="button"
              class="close"
              aria-label="Close"
              (click)="closed.emit()"
            >
              ×
            </button>
          </div>
        </header>
        <div class="body">
          <div class="section-heading">
            <h3>Definitions</h3>
            <div class="header-actions">
              <button
                type="button"
                class="icon-btn"
                aria-label="Ask AI for definitions"
                title="Ask AI for definitions"
                [attr.aria-busy]="asking() ? true : null"
                [disabled]="busy() || asking() || askingForms() !== null"
                (click)="askDefinitions()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                  />
                  <path d="M5 3v4" />
                  <path d="M3 5h4" />
                  <path d="M19 17v4" />
                  <path d="M17 19h4" />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label="Add a definition"
                title="Add a definition"
                [disabled]="busy() || asking() || askingForms() !== null"
                (click)="openDefinition(null)"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
              </button>
            </div>
          </div>
          @if (collision(); as matches) {
            <div class="collision" role="menu" aria-label="Matching elements">
              @for (match of matches; track match.elementId) {
                <button type="button" (click)="visitHighlight(match.elementId)">
                  {{ match.title }}
                </button>
              }
            </div>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          @if (suggestions().length) {
            <ol class="definitions">
              @for (suggestion of suggestions(); track suggestion.text; let index = $index) {
                <li class="sense suggestion">
                  <div class="sense-main">
                    <div class="sense-copy">
                      @let passage = parsePassage(suggestion.text);
                      @if (passage.text) {
                        <p class="passage">{{ passage.text }}</p>
                      }
                      @if (passage.translations.length) {
                        <ul class="equivalents">
                          @for (translation of passage.translations; track $index) {
                            <li>{{ translation.text }}</li>
                          }
                        </ul>
                      }
                      @if (entries(suggestion.metadata); as meta) {
                        @if (meta.length) {
                          <ul class="pills">
                            @for (entry of meta; track entry.key) {
                              <li>
                                <span>{{ entry.key }}: {{ entry.value }}</span>
                              </li>
                            }
                          </ul>
                        }
                      }
                    </div>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Dismiss definition"
                      title="Dismiss definition"
                      [disabled]="busy()"
                      (click)="dismissSuggestion(index)"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    class="btn btn-primary add-suggestion"
                    [disabled]="busy() || asking() || askingForms() !== null"
                    (click)="addSuggestion(index)"
                  >
                    Add
                  </button>
                </li>
              }
            </ol>
          }
          @if (element().definitions.length) {
            <ol class="definitions">
              @for (definition of element().definitions; track $index; let index = $index) {
                <li class="sense">
                  <div class="sense-main">
                    <div class="sense-copy">
                      @let passage = parsePassage(definition.text);
                      @if (passage.text) {
                        <p class="passage">
                          @for (part of highlightPassage(passage.text, index); track $index) {
                            @if (part.matches.length > 1) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [textContent]="part.text"
                                (click)="showCollision($event, part.matches)"
                              ></button>
                            } @else if (part.matches.length === 1 && !part.current) {
                              <button
                                type="button"
                                class="linguagem-highlighted"
                                [textContent]="part.text"
                                (click)="visitHighlight(part.matches[0].elementId)"
                              ></button>
                            } @else if (part.current) {
                              <span
                                class="linguagem-highlighted linguagem-highlighted--current"
                                [textContent]="part.text"
                              ></span>
                            } @else {
                              <span [textContent]="part.text"></span>
                            }
                          }
                        </p>
                      }
                      @if (passage.translations.length) {
                        <ul class="equivalents">
                          @for (translation of passage.translations; track $index) {
                            <li>{{ translation.text }}</li>
                          }
                        </ul>
                      }
                      @if (entries(definition.metadata); as meta) {
                        @if (meta.length) {
                          <ul class="pills">
                            @for (entry of meta; track entry.key) {
                              <li>
                                <span>{{ entry.key }}: {{ entry.value }}</span>
                              </li>
                            }
                          </ul>
                        }
                      }
                    </div>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Edit definition"
                      title="Edit definition"
                      [disabled]="busy()"
                      (click)="openDefinition(index)"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                  </div>

                  <section class="group">
                    <div class="section-heading">
                      <h3>Examples</h3>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Add an example"
                        title="Add an example"
                        [disabled]="busy()"
                        (click)="openExample(index, null)"
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                      </button>
                    </div>
                    @if (definition.examples.length) {
                      <ul class="examples">
                        @for (
                          example of definition.examples;
                          track $index;
                          let exampleIndex = $index
                        ) {
                          <li>
                            <div class="example-copy">
                              @let passage = parsePassage(example.text);
                              @if (passage.text) {
                                <q class="passage">
                                  @for (
                                    part of highlightPassage(passage.text, index);
                                    track $index
                                  ) {
                                    @if (part.matches.length > 1) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [textContent]="part.text"
                                        (click)="showCollision($event, part.matches)"
                                      ></button>
                                    } @else if (part.matches.length === 1 && !part.current) {
                                      <button
                                        type="button"
                                        class="linguagem-highlighted"
                                        [textContent]="part.text"
                                        (click)="visitHighlight(part.matches[0].elementId)"
                                      ></button>
                                    } @else if (part.current) {
                                      <span
                                        class="linguagem-highlighted linguagem-highlighted--current"
                                        [textContent]="part.text"
                                      ></span>
                                    } @else {
                                      <span [textContent]="part.text"></span>
                                    }
                                  }
                                </q>
                              }
                              @if (passage.translations.length) {
                                <ul class="equivalents">
                                  @for (translation of passage.translations; track $index) {
                                    <li>{{ translation.text }}</li>
                                  }
                                </ul>
                              }
                              @if (entries(example.metadata); as meta) {
                                @if (meta.length) {
                                  <ul class="pills">
                                    @for (entry of meta; track entry.key) {
                                      <li>
                                        <span>{{ entry.key }}: {{ entry.value }}</span>
                                      </li>
                                    }
                                  </ul>
                                }
                              }
                            </div>
                            <button
                              type="button"
                              class="icon-btn"
                              aria-label="Edit example"
                              title="Edit example"
                              [disabled]="busy()"
                              (click)="openExample(index, exampleIndex)"
                            >
                              <svg viewBox="0 0 24 24">
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="hint">No examples yet.</p>
                    }
                  </section>

                  <section class="group">
                    <div class="section-heading">
                      <h3>Forms</h3>
                      <div class="header-actions">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Ask AI for forms"
                          title="Ask AI for forms"
                          [attr.aria-busy]="askingForms() === index ? true : null"
                          [disabled]="busy() || asking() || askingForms() !== null"
                          (click)="askForms(index)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                            />
                            <path d="M5 3v4" />
                            <path d="M3 5h4" />
                            <path d="M19 17v4" />
                            <path d="M17 19h4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Add a form"
                          title="Add a form"
                          [disabled]="busy() || asking() || askingForms() !== null"
                          (click)="openForm(index)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (formEdit(); as editing) {
                      @if (editing.definitionIndex === index) {
                        <div class="form-edit">
                          <input
                            #formField
                            [value]="formDraft()"
                            [attr.maxlength]="formMaxLength"
                            placeholder="walked"
                            aria-label="New form"
                            (input)="onFormInput($event)"
                            (keydown.enter)="saveForm()"
                          />
                          <button
                            type="button"
                            class="icon-btn"
                            [disabled]="busy() || !formDraft().trim()"
                            aria-label="Add form"
                            (click)="saveForm()"
                          >
                            <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                          </button>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Cancel"
                            (click)="cancelForm()"
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                        @if (formError()) {
                          <p class="error">{{ formError() }}</p>
                        }
                        <div class="meta">
                          <div class="section-heading">
                            <h3>Features</h3>
                            @if (!formFeatureEdit()) {
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Add feature"
                                title="Add feature"
                                [disabled]="busy()"
                                (click)="openFormFeature(null)"
                              >
                                <svg viewBox="0 0 24 24">
                                  <path d="M5 12h14" />
                                  <path d="M12 5v14" />
                                </svg>
                              </button>
                            }
                          </div>
                          @if (formFeatureEdit(); as feature) {
                            <div class="meta-edit">
                              <input
                                #formFeatureField
                                [value]="formFeatureKey()"
                                [attr.maxlength]="metaKeyMaxLength"
                                placeholder="Key"
                                aria-label="Feature key"
                                (input)="formFeatureKey.set(inputValue($event))"
                                (keydown.enter)="saveFormFeature()"
                              />
                              <input
                                [value]="formFeatureValue()"
                                [attr.maxlength]="metaValueMaxLength"
                                placeholder="Value"
                                aria-label="Feature value"
                                (input)="formFeatureValue.set(inputValue($event))"
                                (keydown.enter)="saveFormFeature()"
                              />
                              <button
                                type="button"
                                class="icon-btn"
                                [disabled]="
                                  busy() || !formFeatureKey().trim() || !formFeatureValue().trim()
                                "
                                [attr.aria-label]="
                                  feature.previousKey ? 'Save feature' : 'Add feature'
                                "
                                (click)="saveFormFeature()"
                              >
                                <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                              </button>
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Cancel"
                                (click)="cancelFormFeature()"
                              >
                                <svg viewBox="0 0 24 24">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          }
                          @if (entries(formFeatures()); as features) {
                            @if (features.length) {
                              <ul class="pills">
                                @for (entry of features; track entry.key) {
                                  @if (formFeatureEdit()?.previousKey !== entry.key) {
                                    <li>
                                      <button
                                        type="button"
                                        [disabled]="busy()"
                                        [attr.aria-label]="'Edit feature ' + entry.key"
                                        (click)="openFormFeature(entry.key)"
                                      >
                                        {{ entry.key }}: {{ entry.value }}
                                      </button>
                                      <button
                                        type="button"
                                        class="tag-remove"
                                        [disabled]="busy()"
                                        [attr.aria-label]="'Remove feature ' + entry.key"
                                        (click)="removeFormFeature(entry.key)"
                                      >
                                        ×
                                      </button>
                                    </li>
                                  }
                                }
                              </ul>
                            }
                          }
                        </div>
                      }
                    }
                    @if (definition.forms.length) {
                      <ul class="forms">
                        @for (form of definition.forms; track form.text) {
                          <li>
                            <div class="form-chip">
                              <button
                                type="button"
                                [disabled]="busy()"
                                [attr.aria-label]="'Show metadata for ' + form.text"
                                (click)="openFormInfo(index, form.text)"
                              >
                                {{ form.text }}
                              </button>
                              <button
                                type="button"
                                class="tag-remove"
                                [disabled]="busy()"
                                [attr.aria-label]="'Remove form ' + form.text"
                                (click)="removeForm(index, form.text)"
                              >
                                ×
                              </button>
                            </div>
                          </li>
                        }
                      </ul>
                    } @else if (formEdit()?.definitionIndex !== index) {
                      <p class="hint">No forms yet.</p>
                    }
                  </section>
                </li>
              }
            </ol>
          } @else if (!suggestions().length) {
            <p class="empty">No definitions yet.</p>
          }
          <button
            type="button"
            class="btn btn-danger delete-element"
            [disabled]="busy()"
            (click)="askDeleteElement()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete
          </button>
        </div>

        @if (editor(); as current) {
          <div class="sheet-backdrop" (click)="closeSheet($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="sheetTitle(current)"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>{{ sheetTitle(current) }}</h3>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="editor.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div class="field-heading">
                <label
                  [attr.for]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                >
                  {{ current.kind === 'definition' ? 'Definition' : 'Example' }}
                </label>
                <button
                  type="button"
                  class="icon-btn"
                  [attr.aria-label]="translating() ? 'Translating…' : 'Translate'"
                  [attr.title]="translating() ? 'Translating…' : 'Translate'"
                  [disabled]="!canTranslate()"
                  (click)="translateDraft()"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="m5 8 6 6" />
                    <path d="m4 14 6-6 2-3" />
                    <path d="M2 5h12" />
                    <path d="M7 2h1" />
                    <path d="m22 22-5-10-5 10" />
                    <path d="M14 18h6" />
                  </svg>
                </button>
              </div>
              <textarea
                #draftField
                [id]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
                rows="3"
                [value]="textDraft()"
                (input)="textDraft.set(inputValue($event))"
              ></textarea>
              @if (sheetTranslations().length) {
                <ul class="equivalents">
                  @for (translation of sheetTranslations(); track $index) {
                    <li>{{ translation.text }}</li>
                  }
                </ul>
              }
              @if (sheetError()) {
                <p class="error">{{ sheetError() }}</p>
              }
              @if (current.kind === 'definition') {
                @if (element().equivalents.length) {
                  <p class="field-label">Equivalent</p>
                  <ul class="equivalent-choices">
                    @for (item of element().equivalents; track item.id) {
                      <li>
                        <button
                          type="button"
                          [class.selected]="equivalentSelected(item.id)"
                          [attr.aria-pressed]="equivalentSelected(item.id)"
                          [disabled]="busy()"
                          (click)="chooseEquivalent(item.id)"
                        >
                          {{ item.text }}
                        </button>
                      </li>
                    }
                  </ul>
                }
                <label for="definition-equivalent">
                  {{ element().equivalents.length ? 'New equivalent' : 'Equivalent' }}
                </label>
                <input
                  id="definition-equivalent"
                  [value]="equivalentDraft()"
                  (input)="equivalentDraft.set(inputValue($event))"
                  autocomplete="off"
                  placeholder="Type a new equivalent"
                />
              }
              <div class="meta">
                <div class="section-heading">
                  <h3>Metadata</h3>
                  @if (!metaEdit()) {
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Add metadata"
                      title="Add metadata"
                      [disabled]="busy()"
                      (click)="openMetadata(null)"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                    </button>
                  }
                </div>
                @if (metaEdit(); as editing) {
                  <div class="meta-edit">
                    <input
                      #metaKeyField
                      [value]="metaKey()"
                      [attr.maxlength]="metaKeyMaxLength"
                      placeholder="Key"
                      aria-label="Metadata key"
                      (input)="metaKey.set(inputValue($event))"
                      (keydown.enter)="saveMetadata()"
                    />
                    <input
                      [value]="metaValue()"
                      [attr.maxlength]="metaValueMaxLength"
                      placeholder="Value"
                      aria-label="Metadata value"
                      (input)="metaValue.set(inputValue($event))"
                      (keydown.enter)="saveMetadata()"
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      [disabled]="busy() || !metaKey().trim() || !metaValue().trim()"
                      [attr.aria-label]="editing.previousKey ? 'Save metadata' : 'Add metadata'"
                      (click)="saveMetadata()"
                    >
                      <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="Cancel"
                      (click)="cancelMetadata()"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                }
                @if (entries(sheetMetadata()); as meta) {
                  @if (meta.length) {
                    <ul class="pills">
                      @for (entry of meta; track entry.key) {
                        @if (metaEdit()?.previousKey !== entry.key) {
                          <li>
                            <button
                              type="button"
                              [disabled]="busy()"
                              [attr.aria-label]="'Edit metadata ' + entry.key"
                              (click)="openMetadata(entry.key)"
                            >
                              {{ entry.key }}: {{ entry.value }}
                            </button>
                            <button
                              type="button"
                              class="tag-remove"
                              [disabled]="busy()"
                              [attr.aria-label]="'Remove metadata ' + entry.key"
                              (click)="removeMetadata(entry.key)"
                            >
                              ×
                            </button>
                          </li>
                        }
                      }
                    </ul>
                  }
                }
              </div>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() || translating() || !textDraft().trim()"
                  (click)="saveEditor()"
                >
                  Save
                </button>
                @if (
                  current.kind === 'definition'
                    ? current.index != null
                    : current.exampleIndex != null
                ) {
                  <button
                    type="button"
                    class="btn btn-danger"
                    [disabled]="busy()"
                    (click)="askDelete()"
                  >
                    {{ current.kind === 'definition' ? 'Delete definition' : 'Delete example' }}
                  </button>
                }
              </div>
            </section>
          </div>
        }

        @if (formInfo(); as info) {
          <div class="sheet-backdrop" (click)="closeFormInfo($event)">
            <section
              class="sheet"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="'Metadata for ' + info.text"
              (click)="$event.stopPropagation()"
            >
              <div class="sheet-head">
                <h3>{{ info.text }}</h3>
                <button
                  #formInfoClose
                  type="button"
                  class="icon-btn"
                  aria-label="Close"
                  (click)="formInfo.set(null)"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              @if (formMetadata(info); as features) {
                @if (features.length) {
                  <ul class="pills">
                    @for (entry of features; track entry.key) {
                      <li>
                        <span>{{ entry.key }}: {{ entry.value }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="hint">No metadata yet.</p>
                }
              }
            </section>
          </div>
        }

        @if (confirm(); as pending) {
          <div class="sheet-backdrop" (click)="closeSheet($event)">
            <section
              class="sheet confirm"
              role="dialog"
              aria-modal="true"
              [attr.aria-label]="confirmTitle(pending)"
              (click)="$event.stopPropagation()"
            >
              <h3>{{ confirmTitle(pending) }}</h3>
              <p class="hint">
                {{
                  pending.kind === 'element'
                    ? 'This element will be removed.'
                    : 'This will be removed.'
                }}
              </p>
              <div class="sheet-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="busy()"
                  (click)="confirm.set(null)"
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
            </section>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
    }

    .backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(100%, 42rem);
      height: min(90dvh, calc(100dvh - 2.5rem));
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }

    header,
    .sheet-head,
    .section-heading,
    .sheet-actions {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    header,
    .sheet-head,
    .section-heading {
      justify-content: space-between;
    }

    header {
      align-items: flex-start;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
      border-bottom: 1px solid var(--border);
    }

    .title-block {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .equivalents {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .equivalent-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .equivalent-choices button {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      padding: 0.28rem 0.7rem;
      cursor: pointer;
    }

    .equivalent-choices button.selected {
      color: var(--accent-text);
      border-color: rgba(var(--accent-rgb), 0.45);
      background: rgba(var(--accent-rgb), 0.12);
    }

    .equivalent-choices button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      min-width: 0;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    .close,
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .close {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
    }

    .close:hover,
    .icon-btn:hover:not(:disabled) {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .icon-btn {
      width: 1.8rem;
      height: 1.8rem;
      border-radius: 0.4rem;
    }

    .icon-btn:disabled,
    .form-chip button:disabled,
    .pills button:disabled,
    .tag-remove:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .icon-btn svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 1rem 1.15rem 1.25rem;
    }

    .delete-element {
      align-self: stretch;
      gap: 0.45rem;
      width: 100%;
      margin-top: auto;
    }

    .delete-element svg {
      display: block;
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    h3 {
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1;
      text-transform: uppercase;
    }

    .empty,
    .hint,
    .error {
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    .error {
      color: var(--danger);
    }

    .definitions,
    .examples,
    .forms,
    .pills {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definitions {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .sense {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0.8rem 0.9rem;
      border: 1px solid rgba(139, 144, 165, 0.16);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, 0.02);
    }

    .suggestion {
      border-style: dashed;
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    .suggestion .passage {
      color: var(--accent-text);
    }

    .suggestion .pills li {
      background: rgba(var(--accent-rgb), 0.16);
      color: var(--accent-text);
    }

    .add-suggestion {
      align-self: flex-end;
    }

    .sense-main {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .sense-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .passage {
      white-space: pre-wrap;
    }

    .linguagem-highlighted {
      background: transparent;
      color: inherit;
      border-bottom: none;
      text-decoration-line: underline;
      text-decoration-style: var(--highlight-style, solid);
      text-decoration-color: var(--highlight-color, #6c63ff);
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
    }

    button.linguagem-highlighted {
      display: inline;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
      text-align: inherit;
    }

    .linguagem-highlighted--current {
      text-decoration: none;
      border-radius: 0.18em;
      padding: 0 0.12em;
      background: color-mix(in srgb, var(--highlight-color, #6c63ff) 32%, transparent);
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }

    .collision {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .collision button {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.8125rem;
      padding: 0.28rem 0.7rem;
      cursor: pointer;
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding-inline-start: 1.5rem;
    }

    .forms {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .forms li {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }

    .form-chip,
    .pills li {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .form-chip button,
    .pills button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .form-chip > button:first-child,
    .pills li > button:first-child,
    .pills li > span {
      padding: 0.2rem 0.15rem 0.2rem 0.55rem;
    }

    .pills li > span {
      padding-inline-end: 0.55rem;
    }

    .tag-remove {
      padding: 0.2rem 0.45rem 0.2rem 0.15rem;
      line-height: 1;
    }

    .form-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .form-edit input {
      flex: 1;
    }

    .examples {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .examples li {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .example-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    q {
      quotes: '“' '”';
    }

    .meta {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .meta-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .meta-edit input {
      flex: 1;
      min-width: 0;
    }

    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .sheet-backdrop {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem;
      background: rgba(8, 10, 16, 0.55);
    }

    .sheet {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      width: min(100%, 32rem);
      max-height: 100%;
      overflow: auto;
      box-sizing: border-box;
      padding: 0.9rem 1rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
    }

    .sheet h3 {
      color: var(--text);
      font-size: 1rem;
      letter-spacing: -0.02em;
      text-transform: none;
    }

    .field-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    label,
    .field-label {
      font-size: 0.78rem;
      font-weight: 650;
      color: var(--text-muted);
    }

    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      resize: vertical;
    }

    .sheet-actions {
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid color-mix(in srgb, var(--danger) 55%, transparent);
    }

    .btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }
  `,
})
export class ElementModal {
  readonly element = input.required<StoredElement>();
  readonly collection = input<StoredElement[]>([]);
  readonly closed = output<void>();
  readonly changed = output<StoredElement>();
  readonly deleted = output<void>();
  readonly visit = output<string>();

  readonly formMaxLength = FORM_MAX_LENGTH;
  readonly metaKeyMaxLength = META_KEY_MAX_LENGTH;
  readonly metaValueMaxLength = META_VALUE_MAX_LENGTH;
  readonly parsePassage = parsePassage;
  readonly editor = signal<Editor | null>(null);
  readonly equivalentDraft = signal('');
  readonly equivalentIdDraft = signal<string | null>(null);
  readonly textDraft = signal('');
  readonly sheetTranslations = signal<PassageTranslation[]>([]);
  readonly translating = signal(false);
  readonly sheetError = signal('');
  readonly formEdit = signal<FormEdit | null>(null);
  readonly formInfo = signal<{ definitionIndex: number; text: string } | null>(null);
  readonly formDraft = signal('');
  readonly formError = signal('');
  readonly formFeatures = signal<ElementMetadata>({});
  readonly formFeatureEdit = signal<MetadataEdit | null>(null);
  readonly formFeatureKey = signal('');
  readonly formFeatureValue = signal('');
  readonly metaEdit = signal<MetadataEdit | null>(null);
  readonly metaKey = signal('');
  readonly metaValue = signal('');
  readonly sheetMetadata = signal<ElementMetadata>({});
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly asking = signal(false);
  readonly askingForms = signal<number | null>(null);
  readonly suggestions = signal<Array<{ text: string; metadata: ElementMetadata }>>([]);
  readonly error = signal('');

  private translateTicket = 0;
  private trackedElementId = '';
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly draftField = viewChild<ElementRef<HTMLTextAreaElement>>('draftField');
  private readonly formField = viewChild<ElementRef<HTMLInputElement>>('formField');
  private readonly formInfoClose = viewChild<ElementRef<HTMLButtonElement>>('formInfoClose');
  private readonly formFeatureField = viewChild<ElementRef<HTMLInputElement>>('formFeatureField');
  private readonly metaKeyField = viewChild<ElementRef<HTMLInputElement>>('metaKeyField');

  constructor() {
    effect(() => {
      const id = this.element().id;
      if (id === this.trackedElementId) return;
      this.trackedElementId = id;
      this.editor.set(null);
      this.formEdit.set(null);
      this.formInfo.set(null);
      this.formError.set('');
      this.formFeatureEdit.set(null);
      this.metaEdit.set(null);
      this.collision.set(null);
      this.confirm.set(null);
      this.askingForms.set(null);
      this.suggestions.set([]);
    });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => {
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm()) {
      this.confirm.set(null);
      return;
    }
    if (this.metaEdit()) {
      this.metaEdit.set(null);
      return;
    }
    if (this.editor()) {
      this.editor.set(null);
      return;
    }
    if (this.formFeatureEdit()) {
      this.formFeatureEdit.set(null);
      return;
    }
    if (this.formInfo()) {
      this.formInfo.set(null);
      return;
    }
    if (this.formEdit()) {
      this.formEdit.set(null);
      return;
    }
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  closeSheet(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    if (this.confirm()) this.confirm.set(null);
    else this.editor.set(null);
  }

  headerEquivalents(): string[] {
    const seen = new Set<string>();
    const texts: string[] = [];
    for (const definition of this.element().definitions) {
      const text = this.equivalentText(definition);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    return texts;
  }

  equivalentSelected(id: string): boolean {
    const typed = this.equivalentDraft().trim();
    if (typed) {
      return this.element().equivalents.some((item) => item.id === id && item.text === typed);
    }
    return this.equivalentIdDraft() === id;
  }

  chooseEquivalent(id: string): void {
    const selected = this.equivalentSelected(id);
    this.equivalentDraft.set('');
    this.equivalentIdDraft.set(selected ? null : id);
  }

  equivalentText(definition: ElementDefinition): string {
    const id = definition.equivalentId;
    if (!id) return '';
    return this.element().equivalents.find((item) => item.id === id)?.text ?? '';
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  sheetTitle(editor: Editor): string {
    if (editor.kind === 'definition') {
      return editor.index == null ? 'Add a definition' : 'Edit definition';
    }
    return editor.exampleIndex == null ? 'Add an example' : 'Edit example';
  }

  async askDefinitions(): Promise<void> {
    if (this.asking() || this.busy()) return;
    const element = this.element();
    const title = element.title.trim();
    if (!title) return;
    this.asking.set(true);
    this.error.set('');
    try {
      const senses = await generateDefinitions({
        language: element.language,
        title,
        existingDefinitions: [
          ...element.definitions.map((definition) => ({
            text: definition.text,
            metadata: definition.metadata,
          })),
          ...this.suggestions().map((suggestion) => ({
            text: suggestion.text,
            metadata: suggestion.metadata,
          })),
        ],
      });
      const seen = new Set(
        [
          ...element.definitions.map((definition) => definition.text),
          ...this.suggestions().map((suggestion) => suggestion.text),
        ].map((text) => parsePassage(text).text.trim().toLowerCase()),
      );
      const next = senses.filter((sense) => {
        const key = parsePassage(sense.text).text.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!next.length) {
        this.error.set('No further definitions.');
        return;
      }
      this.suggestions.update((list) => [...list, ...next]);
    } catch {
      this.error.set('Could not ask for definitions.');
    } finally {
      this.asking.set(false);
    }
  }

  dismissSuggestion(index: number): void {
    if (this.busy()) return;
    this.suggestions.update((list) => list.filter((_, at) => at !== index));
  }

  async addSuggestion(index: number): Promise<void> {
    if (this.asking() || this.askingForms() !== null || this.busy()) return;
    const suggestion = this.suggestions()[index];
    if (!suggestion) return;
    const element = this.element();
    const created: ElementDefinition = {
      text: suggestion.text,
      equivalentId: null,
      forms: [],
      examples: [],
      metadata: { ...suggestion.metadata },
    };
    const definitions = [created, ...this.copyDefinitions()];
    if (!(await this.persist(definitions, element.equivalents))) return;
    this.suggestions.update((list) => list.filter((item) => item !== suggestion));
    this.shiftDefinitionIndexes(1);
  }

  private shiftDefinitionIndexes(by: number): void {
    const editing = this.formEdit();
    if (editing) this.formEdit.set({ definitionIndex: editing.definitionIndex + by });
    const info = this.formInfo();
    if (info) this.formInfo.set({ ...info, definitionIndex: info.definitionIndex + by });
    const editor = this.editor();
    if (editor?.kind === 'definition' && editor.index != null) {
      this.editor.set({ kind: 'definition', index: editor.index + by });
    }
    if (editor?.kind === 'example') {
      this.editor.set({ ...editor, definitionIndex: editor.definitionIndex + by });
    }
    const pending = this.confirm();
    if (pending?.kind === 'definition') {
      this.confirm.set({ kind: 'definition', index: pending.index + by });
    }
    if (pending?.kind === 'example') {
      this.confirm.set({ ...pending, definitionIndex: pending.definitionIndex + by });
    }
  }

  async askForms(index: number): Promise<void> {
    if (this.asking() || this.askingForms() !== null || this.busy()) return;
    const element = this.element();
    const definition = element.definitions[index];
    const gloss = parsePassage(definition?.text ?? '').text.trim();
    if (!definition || !gloss) return;
    this.askingForms.set(index);
    this.error.set('');
    try {
      const forms = await generateForms({
        language: element.language,
        title: element.title,
        gloss,
        existingForms: definition.forms.map((form) => form.text),
      });
      if (!forms.length) {
        this.error.set('No further forms.');
        return;
      }
      const definitions = this.copyDefinitions();
      const target = definitions[index];
      if (!target) return;
      const seen = new Set(target.forms.map((form) => form.text.toLowerCase()));
      for (const form of forms) {
        const key = form.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        target.forms.push(form);
      }
      await this.persist(definitions, element.equivalents);
    } catch {
      this.error.set('Could not ask for forms.');
    } finally {
      this.askingForms.set(null);
    }
  }

  openDefinition(index: number | null): void {
    const definition = index == null ? null : this.element().definitions[index];
    if (index != null && !definition) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.sheetMetadata.set({ ...(definition?.metadata ?? {}) });
    const equivalentId = definition?.equivalentId ?? null;
    const known =
      equivalentId && this.element().equivalents.some((item) => item.id === equivalentId)
        ? equivalentId
        : null;
    this.equivalentIdDraft.set(known);
    this.equivalentDraft.set('');
    this.beginSheet(definition?.text ?? '');
    this.editor.set({ kind: 'definition', index });
    this.focusDraft();
  }

  openExample(definitionIndex: number, exampleIndex: number | null): void {
    const definition = this.element().definitions[definitionIndex];
    if (!definition) return;
    const example = exampleIndex == null ? null : definition.examples[exampleIndex];
    if (exampleIndex != null && !example) return;
    this.formEdit.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.sheetMetadata.set({ ...(example?.metadata ?? {}) });
    this.beginSheet(example?.text ?? '');
    this.editor.set({ kind: 'example', definitionIndex, exampleIndex });
    this.focusDraft();
  }

  openFormInfo(definitionIndex: number, text: string): void {
    if (this.busy()) return;
    const form = this.element().definitions[definitionIndex]?.forms.find(
      (item) => item.text === text,
    );
    if (!form) return;
    this.formInfo.set({ definitionIndex, text });
    setTimeout(() => this.formInfoClose()?.nativeElement.focus());
  }

  closeFormInfo(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.formInfo.set(null);
  }

  formMetadata(info: { definitionIndex: number; text: string }): Array<{
    key: string;
    value: string;
  }> {
    const form = this.element().definitions[info.definitionIndex]?.forms.find(
      (item) => item.text === info.text,
    );
    return form ? this.entries(form.metadata) : [];
  }

  openForm(definitionIndex: number): void {
    if (!this.element().definitions[definitionIndex]) return;
    this.editor.set(null);
    this.metaEdit.set(null);
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formFeatures.set({});
    this.formDraft.set('');
    this.formEdit.set({ definitionIndex });
    setTimeout(() => this.formField()?.nativeElement.focus());
  }

  onFormInput(event: Event): void {
    this.formError.set('');
    this.formDraft.set(this.inputValue(event));
  }

  cancelForm(): void {
    this.formError.set('');
    this.formFeatureEdit.set(null);
    this.formEdit.set(null);
  }

  openFormFeature(previousKey: string | null): void {
    const metadata = this.formFeatures();
    this.formFeatureKey.set(previousKey ?? '');
    this.formFeatureValue.set(previousKey ? (metadata[previousKey] ?? '') : '');
    this.formFeatureEdit.set({ previousKey });
    setTimeout(() => this.formFeatureField()?.nativeElement.focus());
  }

  cancelFormFeature(): void {
    this.formFeatureEdit.set(null);
  }

  private formFeaturesToStore(): ElementMetadata {
    const editing = this.formFeatureEdit();
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value) return { ...this.formFeatures() };
    return writeMetadata(this.formFeatures(), editing.previousKey, key, value);
  }

  saveFormFeature(): void {
    const editing = this.formFeatureEdit();
    const key = this.formFeatureKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.formFeatureValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value || this.busy()) return;
    const current = this.formFeatures();
    if (editing.previousKey === key && current[key] === value) {
      this.cancelFormFeature();
      return;
    }
    this.formFeatures.set(writeMetadata(current, editing.previousKey, key, value));
    this.cancelFormFeature();
  }

  removeFormFeature(key: string): void {
    if (this.busy()) return;
    const next = { ...this.formFeatures() };
    delete next[key];
    this.formFeatures.set(next);
    if (this.formFeatureEdit()?.previousKey === key) this.cancelFormFeature();
  }

  openMetadata(previousKey: string | null): void {
    const metadata = this.sheetMetadata();
    this.metaKey.set(previousKey ?? '');
    this.metaValue.set(previousKey ? (metadata[previousKey] ?? '') : '');
    this.metaEdit.set({ previousKey });
    setTimeout(() => this.metaKeyField()?.nativeElement.focus());
  }

  cancelMetadata(): void {
    this.metaEdit.set(null);
  }

  highlightPassage(text: string, definitionIndex: number): DefinitionHighlightPart[] {
    const element = this.element();
    const definition = element.definitions[definitionIndex];
    const others: { id: string; title: string; forms: string[] }[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      for (const sense of item.definitions) {
        others.push({ id: item.id, title: item.title, forms: formTexts(sense.forms) });
      }
    }
    return highlightDefinitionPassage(
      text,
      { id: element.id, title: element.title, forms: formTexts(definition?.forms ?? []) },
      others,
    );
  }

  showCollision(event: MouseEvent, matches: DefinitionHighlightMatch[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.collision.set(matches);
  }

  visitHighlight(id: string): void {
    this.collision.set(null);
    if (!id || id === this.element().id) return;
    this.visit.emit(id);
  }

  canTranslate(): boolean {
    const draft = this.textDraft().trim();
    return (
      this.element().language !== 'en' &&
      draft.length > 0 &&
      this.sheetTranslations().length === 0 &&
      parsePassage(draft).translations.length === 0 &&
      !this.translating() &&
      !this.busy()
    );
  }

  async translateDraft(): Promise<void> {
    if (!this.canTranslate()) return;
    const text = this.textDraft().trim();
    const source = this.element().language;
    const ticket = this.translateTicket;
    this.translating.set(true);
    this.sheetError.set('');
    try {
      const translated = await translatePhrase(text, source);
      if (ticket !== this.translateTicket) return;
      this.sheetTranslations.set([{ language: 'en', text: translated }]);
    } catch {
      if (ticket !== this.translateTicket) return;
      this.sheetError.set('Could not translate this.');
    } finally {
      if (ticket === this.translateTicket) this.translating.set(false);
    }
  }

  async saveEditor(): Promise<void> {
    const editor = this.editor();
    const primary = this.textDraft().trim();
    if (!editor || !primary || this.busy() || this.translating()) return;
    const text = this.phraseToStore();
    const definitions = this.copyDefinitions();
    if (editor.kind === 'definition') {
      const current = editor.index == null ? null : definitions[editor.index];
      if (editor.index != null && !current) return;
      const typed = this.equivalentDraft().trim();
      const selectedId = this.equivalentIdDraft();
      const linked = typed
        ? assignEquivalent(this.element().equivalents, typed)
        : {
            equivalents: this.element().equivalents,
            equivalentId:
              selectedId && this.element().equivalents.some((item) => item.id === selectedId)
                ? selectedId
                : null,
          };
      const next: ElementDefinition = {
        text,
        equivalentId: linked.equivalentId,
        forms: current?.forms ?? [],
        examples: current?.examples ?? [],
        metadata: this.metadataToStore(),
      };
      if (editor.index == null) definitions.push(next);
      else definitions[editor.index] = next;
      if (await this.persist(definitions, linked.equivalents)) this.editor.set(null);
      return;
    }
    const definition = definitions[editor.definitionIndex];
    if (!definition) return;
    const current = editor.exampleIndex == null ? null : definition.examples[editor.exampleIndex];
    if (editor.exampleIndex != null && !current) return;
    const next = {
      text,
      metadata: this.metadataToStore(),
    };
    if (editor.exampleIndex == null) definition.examples.push(next);
    else definition.examples[editor.exampleIndex] = next;
    if (await this.persist(definitions, this.element().equivalents)) this.editor.set(null);
  }

  async saveForm(): Promise<void> {
    const editing = this.formEdit();
    const form = this.formDraft().trim().slice(0, FORM_MAX_LENGTH);
    if (!editing || !form || this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[editing.definitionIndex];
    if (!definition) return;
    if (form === this.element().title.trim()) {
      this.cancelForm();
      return;
    }
    if (!isValidForm(form)) {
      this.formError.set('That form is not valid.');
      return;
    }
    if (definition.forms.some((item) => item.text.toLowerCase() === form.toLowerCase())) {
      this.cancelForm();
      return;
    }
    definition.forms.push({ text: form, metadata: this.formFeaturesToStore() });
    if (await this.persist(definitions, this.element().equivalents)) this.cancelForm();
  }

  private metadataToStore(): ElementMetadata {
    const editing = this.metaEdit();
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value) return { ...this.sheetMetadata() };
    return writeMetadata(this.sheetMetadata(), editing.previousKey, key, value);
  }

  saveMetadata(): void {
    const editing = this.metaEdit();
    const key = this.metaKey().trim().slice(0, META_KEY_MAX_LENGTH);
    const value = this.metaValue().trim().slice(0, META_VALUE_MAX_LENGTH);
    if (!editing || !key || !value || this.busy()) return;
    const current = this.sheetMetadata();
    if (editing.previousKey === key && current[key] === value) {
      this.cancelMetadata();
      return;
    }
    this.sheetMetadata.set(writeMetadata(current, editing.previousKey, key, value));
    this.cancelMetadata();
  }

  removeMetadata(key: string): void {
    if (this.busy()) return;
    const next = { ...this.sheetMetadata() };
    delete next[key];
    this.sheetMetadata.set(next);
    if (this.metaEdit()?.previousKey === key) this.cancelMetadata();
  }

  async removeForm(definitionIndex: number, form: string): Promise<void> {
    if (this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[definitionIndex];
    if (!definition) return;
    definition.forms = definition.forms.filter((item) => item.text !== form);
    if (this.formInfo()?.definitionIndex === definitionIndex && this.formInfo()?.text === form) {
      this.formInfo.set(null);
    }
    await this.persist(definitions, this.element().equivalents);
  }

  confirmTitle(pending: ConfirmDelete): string {
    if (pending.kind === 'element') return 'Delete this element?';
    if (pending.kind === 'definition') return 'Delete this definition?';
    return 'Delete this example?';
  }

  askDeleteElement(): void {
    if (this.busy()) return;
    this.editor.set(null);
    this.formEdit.set(null);
    this.formInfo.set(null);
    this.formFeatureEdit.set(null);
    this.metaEdit.set(null);
    this.confirm.set({ kind: 'element' });
  }

  askDelete(): void {
    const editor = this.editor();
    if (!editor) return;
    if (editor.kind === 'definition' && editor.index != null) {
      this.confirm.set({ kind: 'definition', index: editor.index });
      return;
    }
    if (editor.kind === 'example' && editor.exampleIndex != null) {
      this.confirm.set({
        kind: 'example',
        definitionIndex: editor.definitionIndex,
        exampleIndex: editor.exampleIndex,
      });
    }
  }

  async confirmDelete(): Promise<void> {
    const pending = this.confirm();
    if (!pending || this.busy()) return;
    if (pending.kind === 'element') {
      await this.removeElement();
      return;
    }
    const definitions = this.copyDefinitions();
    if (pending.kind === 'definition') {
      definitions.splice(pending.index, 1);
      const info = this.formInfo();
      if (info && info.definitionIndex >= pending.index) this.formInfo.set(null);
    } else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
    if (await this.persist(definitions, this.element().equivalents)) {
      this.confirm.set(null);
      this.editor.set(null);
    }
  }

  private async removeElement(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await deleteElement(this.element().id);
      this.confirm.set(null);
      this.deleted.emit();
    } catch {
      this.confirm.set(null);
      this.error.set('Could not delete this element.');
    } finally {
      this.busy.set(false);
    }
  }

  private copyDefinitions(): ElementDefinition[] {
    return this.element().definitions.map((definition) => ({
      ...definition,
      forms: definition.forms.map((form) => ({ text: form.text, metadata: { ...form.metadata } })),
      examples: definition.examples.map((example) => ({
        ...example,
        metadata: { ...example.metadata },
      })),
      metadata: { ...definition.metadata },
    }));
  }

  private async persist(
    definitions: ElementDefinition[],
    equivalents: ElementEquivalent[],
  ): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await saveElement({ ...this.element(), definitions, equivalents });
      this.changed.emit(saved);
      return true;
    } catch {
      this.error.set('Could not save this element.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private beginSheet(text: string): void {
    this.translateTicket += 1;
    const passage = parsePassage(text);
    this.textDraft.set(passage.text);
    this.sheetTranslations.set(passage.translations);
    this.sheetError.set('');
    this.translating.set(false);
  }

  private phraseToStore(): string {
    return this.sheetTranslations().reduce(
      (raw, item) => embedTranslation(raw, item.language, item.text),
      this.textDraft().trim(),
    );
  }

  private focusDraft(): void {
    setTimeout(() => this.draftField()?.nativeElement.focus());
  }
}
