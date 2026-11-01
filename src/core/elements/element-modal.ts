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
import { translatePhrase } from '../translate/translate';

const FORM_MAX_LENGTH = 100;

type Editor =
  | { kind: 'definition'; index: number | null }
  | { kind: 'example'; definitionIndex: number; exampleIndex: number | null };

type FormEdit = { definitionIndex: number; previous: string | null };

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
              type="button"
              class="icon-btn danger"
              aria-label="Delete element"
              title="Delete element"
              [disabled]="busy()"
              (click)="askDeleteElement()"
            >
              <svg viewBox="0 0 24 24">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
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
            <button
              type="button"
              class="icon-btn"
              aria-label="Add a definition"
              title="Add a definition"
              [disabled]="busy()"
              (click)="openDefinition(null)"
            >
              <svg viewBox="0 0 24 24">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
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
                          <dl>
                            @for (entry of meta; track entry.key) {
                              <div>
                                <dt>{{ entry.key }}</dt>
                                <dd>{{ entry.value }}</dd>
                              </div>
                            }
                          </dl>
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
                                  <dl>
                                    @for (entry of meta; track entry.key) {
                                      <div>
                                        <dt>{{ entry.key }}</dt>
                                        <dd>{{ entry.value }}</dd>
                                      </div>
                                    }
                                  </dl>
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
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Add a form"
                        title="Add a form"
                        [disabled]="busy()"
                        (click)="openForm(index, null)"
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                      </button>
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
                            [attr.aria-label]="editing.previous ? 'Save form' : 'Add form'"
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
                      }
                    }
                    @if (definition.forms.length) {
                      <ul class="forms">
                        @for (form of definition.forms; track form) {
                          @if (
                            formEdit()?.definitionIndex !== index || formEdit()?.previous !== form
                          ) {
                            <li>
                              <button
                                type="button"
                                [disabled]="busy()"
                                [attr.aria-label]="'Edit form ' + form"
                                (click)="openForm(index, form)"
                              >
                                {{ form }}
                              </button>
                              <button
                                type="button"
                                class="tag-remove"
                                [disabled]="busy()"
                                [attr.aria-label]="'Remove form ' + form"
                                (click)="removeForm(index, form)"
                              >
                                ×
                              </button>
                            </li>
                          }
                        }
                      </ul>
                    } @else if (formEdit()?.definitionIndex !== index) {
                      <p class="hint">No forms yet.</p>
                    }
                  </section>
                </li>
              }
            </ol>
          } @else {
            <p class="empty">No definitions yet.</p>
          }
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
              <label
                [attr.for]="current.kind === 'definition' ? 'definition-text' : 'example-text'"
              >
                {{ current.kind === 'definition' ? 'Definition' : 'Example' }}
              </label>
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
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="!canTranslate()"
                (click)="translateDraft()"
              >
                {{ translating() ? 'Translating…' : 'Translate' }}
              </button>
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

    .icon-btn.danger {
      color: var(--danger);
    }

    .icon-btn.danger:hover:not(:disabled) {
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }

    .icon-btn:disabled,
    .forms button:disabled,
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
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding: 1rem 1.15rem 1.25rem;
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
    .forms {
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
    }

    .forms {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .forms li {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .forms button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .forms li > button:first-child {
      padding: 0.2rem 0.15rem 0.2rem 0.55rem;
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

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.8rem;
      margin: 0.35rem 0 0;
    }

    dl div {
      display: flex;
      gap: 0.35rem;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    dt {
      font-weight: 650;
    }

    dd {
      margin: 0;
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

    .sheet > .btn {
      align-self: flex-start;
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
  readonly parsePassage = parsePassage;
  readonly editor = signal<Editor | null>(null);
  readonly equivalentDraft = signal('');
  readonly equivalentIdDraft = signal<string | null>(null);
  readonly textDraft = signal('');
  readonly sheetTranslations = signal<PassageTranslation[]>([]);
  readonly translating = signal(false);
  readonly sheetError = signal('');
  readonly formEdit = signal<FormEdit | null>(null);
  readonly formDraft = signal('');
  readonly formError = signal('');
  readonly collision = signal<DefinitionHighlightMatch[] | null>(null);
  readonly confirm = signal<ConfirmDelete | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');

  private translateTicket = 0;
  private trackedElementId = '';
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly draftField = viewChild<ElementRef<HTMLTextAreaElement>>('draftField');
  private readonly formField = viewChild<ElementRef<HTMLInputElement>>('formField');

  constructor() {
    effect(() => {
      const id = this.element().id;
      if (id === this.trackedElementId) return;
      this.trackedElementId = id;
      this.editor.set(null);
      this.formEdit.set(null);
      this.formError.set('');
      this.collision.set(null);
      this.confirm.set(null);
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
    if (this.editor()) {
      this.editor.set(null);
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

  openDefinition(index: number | null): void {
    const definition = index == null ? null : this.element().definitions[index];
    if (index != null && !definition) return;
    this.formEdit.set(null);
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
    this.beginSheet(example?.text ?? '');
    this.editor.set({ kind: 'example', definitionIndex, exampleIndex });
    this.focusDraft();
  }

  openForm(definitionIndex: number, previous: string | null): void {
    if (!this.element().definitions[definitionIndex]) return;
    this.editor.set(null);
    this.formError.set('');
    this.formDraft.set(previous ?? '');
    this.formEdit.set({ definitionIndex, previous });
    setTimeout(() => this.formField()?.nativeElement.focus());
  }

  onFormInput(event: Event): void {
    this.formError.set('');
    this.formDraft.set(this.inputValue(event));
  }

  cancelForm(): void {
    this.formError.set('');
    this.formEdit.set(null);
  }

  highlightPassage(text: string, definitionIndex: number): DefinitionHighlightPart[] {
    const element = this.element();
    const definition = element.definitions[definitionIndex];
    const others: { id: string; title: string; forms: string[] }[] = [];
    for (const item of this.collection()) {
      if (item.id === element.id) continue;
      for (const sense of item.definitions) {
        others.push({ id: item.id, title: item.title, forms: sense.forms });
      }
    }
    return highlightDefinitionPassage(
      text,
      { id: element.id, title: element.title, forms: definition?.forms ?? [] },
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
        metadata: current?.metadata ?? {},
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
      metadata: current?.metadata ?? {},
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
    if (editing.previous && form === editing.previous) {
      this.cancelForm();
      return;
    }
    const others = definition.forms.filter((value) => value !== editing.previous);
    if (others.some((value) => value.toLowerCase() === form.toLowerCase())) {
      this.cancelForm();
      return;
    }
    if (editing.previous) {
      const at = definition.forms.indexOf(editing.previous);
      if (at >= 0) definition.forms[at] = form;
      else definition.forms.push(form);
    } else {
      definition.forms.push(form);
    }
    if (await this.persist(definitions, this.element().equivalents)) this.cancelForm();
  }

  async removeForm(definitionIndex: number, form: string): Promise<void> {
    if (this.busy()) return;
    const definitions = this.copyDefinitions();
    const definition = definitions[definitionIndex];
    if (!definition) return;
    definition.forms = definition.forms.filter((item) => item !== form);
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
    if (pending.kind === 'definition') definitions.splice(pending.index, 1);
    else definitions[pending.definitionIndex]?.examples.splice(pending.exampleIndex, 1);
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
      forms: [...definition.forms],
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
