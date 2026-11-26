import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  getLanguageDisplayName,
  SUPPORTED_LANGUAGES,
  type LANGUAGE_CODE,
} from '../i18n/language-code';
import { LanguageService } from '../i18n/language.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import packageJson from '../../../package.json';
import {
  AI_ERROR,
  AiError,
  addStoredAiKey,
  isAiProvider,
  keyHintFromSecret,
  readStoredAiCredentials,
  removeStoredAiKey,
  reorderStoredAiKeys,
  testAiKey,
  type AiProviderId,
  type StoredAiKey,
} from 'ai';
import {
  emptyMetadataIndexes,
  LEARNABLE_LANGUAGES,
  languageDisplayName,
  replaceCollection,
} from 'collection';
import { StatsJob } from '../elements/stats-job';
import { supportSettings, writeGeneralSupportLanguage } from '../languages/translation-language';
import { LanguageAiSettings } from '../languages/language-ai-settings';
import { buildDataFile, downloadDataFile, readDataFile } from './data-file';
import {
  DEFAULT_SCORE_COLORS,
  readScoreColors,
  resetScoreColors,
  SCORE_STEPS,
  writeScoreColor,
  type ScoreStep,
} from './score-colors';

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
  imports: [CdkDropList, CdkDrag, CdkDragHandle, FormsModule, LanguageAiSettings, TranslatePipe],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'settings.title' | translate"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div>
            <h2>{{ 'settings.title' | translate }}</h2>
            <p>{{ 'settings.subtitle' | translate }}</p>
          </div>
          <button type="button" class="icon-btn" [attr.aria-label]="'common.close' | translate" (click)="back()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div class="panel-body">
          <section class="settings-section" [class.expanded]="expanded() === 'language'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'language'"
              (click)="toggle('language')"
            >
              <span class="section-title">
                {{ 'settings.appLanguage' | translate }}
                <span class="section-count">{{ appLanguageName(i18n.currentLanguage) }}</span>
              </span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'language') {
              <div class="section-body">
                <p class="section-hint">{{ 'settings.appLanguageHint' | translate }}</p>
                <label for="settings-app-language">
                  {{ 'settings.appLanguage' | translate }}
                  <select
                    id="settings-app-language"
                    [attr.aria-label]="'settings.appLanguageAria' | translate"
                    [ngModel]="appLanguageValue()"
                    (ngModelChange)="setAppLanguage($event)"
                  >
                    <option value="device">{{ 'settings.useDeviceLanguage' | translate }}</option>
                    @for (code of appLanguages; track code) {
                      <option [value]="code">{{ appLanguageName(code) }}</option>
                    }
                  </select>
                </label>
              </div>
            }
          </section>

          <section class="settings-section" [class.expanded]="expanded() === 'support'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'support'"
              (click)="toggle('support')"
            >
              <span class="section-title">
                {{ 'settings.supportLanguage' | translate }}
                <span class="section-count">{{ supportLabel() }}</span>
              </span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'support') {
              <div class="section-body">
                <p class="section-hint">{{ 'settings.supportHint' | translate }}</p>
                <label for="settings-support-language">
                  {{ 'settings.supportLanguage' | translate }}
                  <select
                    id="settings-support-language"
                    [ngModel]="generalSupport()"
                    (ngModelChange)="setGeneralSupport($event)"
                  >
                    <option value="">{{ 'common.none' | translate }}</option>
                    @for (code of supportLanguages; track code) {
                      <option [value]="code">{{ languageName(code) }}</option>
                    }
                  </select>
                </label>
              </div>
            }
          </section>

          <section class="settings-section" [class.expanded]="expanded() === 'provider'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'provider'"
              (click)="toggle('provider')"
            >
              <span class="section-title">
                {{ 'settings.aiProvider' | translate }}
                <span class="section-count">{{ providerLabel() }}</span>
              </span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'provider') {
              <div class="section-body">
                <p class="section-hint">{{ 'settings.aiHint' | translate }}</p>
                @if (aiNotice(); as notice) {
                  <p class="section-hint" [class.data-error]="notice.error">
                    {{ notice.key | translate: notice.params }}
                  </p>
                }
                <div class="actions">
                  <button type="button" class="btn btn-primary" (click)="toggleAddKey()">
                    {{ (addOpen() ? 'common.cancel' : 'settings.addKey') | translate }}
                  </button>
                </div>
                @if (addOpen()) {
                  <form class="key-form" (submit)="addKey($event)">
                    <label for="settings-ai-provider">
                      {{ 'settings.provider' | translate }}
                      <select
                        id="settings-ai-provider"
                        name="aiProvider"
                        [ngModel]="draftProvider()"
                        (ngModelChange)="selectDraftProvider($event)"
                      >
                        @for (option of providers; track option.id) {
                          <option [value]="option.id">{{ option.label }}</option>
                        }
                      </select>
                    </label>
                    <label for="settings-ai-key">
                      {{ 'settings.apiKey' | translate }}
                      <input
                        id="settings-ai-key"
                        name="aiApiKey"
                        type="text"
                        autocomplete="off"
                        [ngModel]="draftKey()"
                        (ngModelChange)="draftKey.set($event)"
                      />
                    </label>
                    <div class="actions">
                      <button
                        type="button"
                        class="btn btn-secondary"
                        [disabled]="!draftReady() || busyId() !== null"
                        (click)="testDraft()"
                      >
                        {{ 'settings.testKey' | translate }}
                      </button>
                      <button
                        type="submit"
                        class="btn btn-primary"
                        [disabled]="!draftReady() || busyId() !== null"
                      >
                        {{ 'common.save' | translate }}
                      </button>
                    </div>
                  </form>
                }
                @if (keys().length) {
                  @if (keys().length > 1) {
                    <p class="section-hint">{{ 'settings.dragKey' | translate }}</p>
                  }
                  <div
                    class="key-list"
                    cdkDropList
                    cdkDropListLockAxis="y"
                    (cdkDropListDropped)="dropKeys($event)"
                  >
                    @for (key of keys(); track key.id) {
                      <div
                        class="key-row"
                        cdkDrag
                        (cdkDragStarted)="keyDragging.set(true)"
                        (cdkDragEnded)="finishKeyDrag()"
                      >
                        <button
                          type="button"
                          class="key-drag"
                          cdkDragHandle
                          [attr.aria-label]="'settings.dragKey' | translate"
                          [attr.title]="'settings.dragKey' | translate"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="9" cy="7" r="1" />
                            <circle cx="15" cy="7" r="1" />
                            <circle cx="9" cy="12" r="1" />
                            <circle cx="15" cy="12" r="1" />
                            <circle cx="9" cy="17" r="1" />
                            <circle cx="15" cy="17" r="1" />
                          </svg>
                        </button>
                        <div class="key-meta">
                          <span class="key-provider">{{ providerName(key.provider) }}</span>
                          <span class="key-hint">{{ keyHint(key.apiKey) }}</span>
                        </div>
                        <div class="key-actions">
                          <button
                            type="button"
                            class="btn btn-secondary"
                            [disabled]="busyId() !== null"
                            (click)="testSaved(key)"
                          >
                            {{ 'settings.testKey' | translate }}
                          </button>
                          <button
                            type="button"
                            class="btn btn-danger"
                            [disabled]="busyId() !== null"
                            (click)="removeKey(key.id)"
                          >
                            {{ 'common.remove' | translate }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                } @else if (!addOpen()) {
                  <p class="section-hint">{{ 'settings.noKeys' | translate }}</p>
                }
              </div>
            }
          </section>

          <section class="settings-section" [class.expanded]="expanded() === 'score'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'score'"
              (click)="toggle('score')"
            >
              <span class="section-title">{{ 'settings.scoreColors' | translate }}</span>
              <svg class="section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (expanded() === 'score') {
              <div class="section-body">
                <p class="section-hint">{{ 'settings.scoreColorsHint' | translate }}</p>
                @for (step of scoreSteps; track step) {
                  <label class="score-color-row" [attr.for]="'settings-score-' + step">
                    {{ 'settings.scoreStep' | translate: { step: '' + step } }}
                    <input
                      [id]="'settings-score-' + step"
                      class="score-color"
                      type="color"
                      [value]="scoreColor(step)"
                      (input)="setScoreColor(step, $event)"
                    />
                  </label>
                }
                @if (scoreColorsChanged()) {
                  <div class="actions">
                    <button type="button" class="btn btn-secondary" (click)="resetScoreColorEnds()">
                      {{ 'common.reset' | translate }}
                    </button>
                  </div>
                }
              </div>
            }
          </section>

          <app-language-ai-settings [open]="expanded()" (opened)="expanded.set($event)" />

          <section class="settings-section" [class.expanded]="expanded() === 'data'">
            <button
              type="button"
              class="section-header"
              [attr.aria-expanded]="expanded() === 'data'"
              (click)="toggle('data')"
            >
              <span class="section-title">{{ 'settings.yourData' | translate }}</span>
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
                <p class="section-hint">{{ 'settings.dataHint' | translate }}</p>
                @if (confirm() === 'delete') {
                  <p class="section-hint">{{ 'settings.deleteAllHint' | translate }}</p>
                  <div class="actions">
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="cancelConfirm()"
                    >
                      {{ 'common.cancel' | translate }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy()"
                      (click)="confirmDelete()"
                    >
                      {{ 'common.delete' | translate }}
                    </button>
                  </div>
                } @else if (confirm() === 'import') {
                  <p class="section-hint">
                    {{
                      'settings.replaceWith'
                        | translate: { name: importName() || ('settings.thatFile' | translate) }
                    }}
                  </p>
                  <div class="actions">
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="cancelConfirm()"
                    >
                      {{ 'common.cancel' | translate }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="busy()"
                      (click)="confirmImport()"
                    >
                      {{ 'settings.import' | translate }}
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
                      {{ 'settings.download' | translate }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busy()"
                      (click)="dataFile.click()"
                    >
                      {{ 'settings.import' | translate }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy()"
                      (click)="askDelete()"
                    >
                      {{ 'common.delete' | translate }}
                    </button>
                  </div>
                }
                @if (note()) {
                  <p class="saved">{{ note() | translate }}</p>
                }
                @if (error()) {
                  <p class="data-error">{{ error() | translate }}</p>
                }
              </div>
            }
          </section>
        </div>

        <footer class="panel-footer">
          <p class="version">v{{ version }}</p>
          <button type="button" class="done-btn" (click)="back()">
            {{ 'common.done' | translate }}
          </button>
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
      background: var(--surface);
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
      border-bottom: 1px solid var(--border);
    }

    h2,
    p {
      margin: 0;
    }

    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
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
      width: 1.8rem;
      height: 1.8rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover {
      background: rgba(139, 144, 165, 0.16);
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
      padding: 0.85rem 1.15rem 1.15rem;
    }

    .settings-section {
      flex-shrink: 0;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
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
      height: auto;
      padding: 0.15rem 0.45rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.5rem;
      background: rgba(255, 255, 255, 0.04);
      color: #94a3b8;
      font-size: 0.68rem;
      font-weight: 650;
      letter-spacing: 0.02em;
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

    .score-color-row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .score-color {
      width: 2.6rem;
      height: 2rem;
      padding: 0.15rem;
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
      padding: 0.7rem 0.85rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      background: var(--bg);
      color: var(--text);
      font: inherit;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
    }

    input:focus,
    select:focus {
      outline: none;
      border-color: rgba(255, 51, 102, 0.6);
      box-shadow: 0 0 0 1px rgba(255, 51, 102, 0.35);
    }

    .btn {
      border-radius: 0.75rem;
    }

    .btn-primary {
      border: 0;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      opacity: 0.95;
    }

    .btn-secondary {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: var(--bg);
    }

    .btn-danger {
      border-radius: 0.75rem;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .key-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .key-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .key-row {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.55rem 0.65rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.85rem;
      background: rgba(255, 255, 255, 0.03);
    }

    .key-row.cdk-drag-preview {
      box-sizing: border-box;
    }

    .key-drag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text-muted);
      cursor: grab;
    }

    .key-drag:hover {
      background: rgba(139, 144, 165, 0.16);
      color: var(--text);
    }

    .key-drag svg {
      width: 1rem;
      height: 1rem;
      fill: currentColor;
    }

    .key-meta {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }

    .key-provider {
      font-size: 0.84rem;
      font-weight: 650;
    }

    .key-hint {
      color: var(--text-muted);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }

    .key-actions {
      display: flex;
      flex: 0 0 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.35rem;
    }

    .key-actions .btn {
      padding: 0.4rem 0.7rem;
      font-size: 0.78rem;
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
      border-radius: 0.75rem;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      color: white;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 650;
      padding: 0.65rem 1.15rem;
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
      cursor: pointer;
    }

    .done-btn:hover {
      opacity: 0.95;
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
  private readonly i18n = inject(LanguageService);
  readonly appLanguages = SUPPORTED_LANGUAGES;
  readonly appLanguageName = getLanguageDisplayName;
  readonly version = packageJson.version;
  readonly closed = output<void>();
  readonly changed = output<void>();
  readonly expanded = signal<string | null>(null);
  private readonly job = inject(StatsJob);
  private importFile: File | null = null;

  readonly providers = AI_PROVIDERS;
  readonly supportLanguages = LEARNABLE_LANGUAGES;
  readonly supportState = supportSettings;
  readonly keys = signal<StoredAiKey[]>(readStoredAiCredentials().keys);
  readonly addOpen = signal(false);
  readonly draftProvider = signal<AiProviderId>('openai');
  readonly draftKey = signal('');
  readonly busyId = signal<string | null>(null);
  readonly keyDragging = signal(false);
  private ignoreBackdropClick = false;
  readonly aiNotice = signal<{ key: string; params: Record<string, string>; error: boolean } | null>(
    null,
  );
  readonly scoreSteps = SCORE_STEPS;
  readonly scoreColorMap = signal(readScoreColors());
  readonly busy = signal(false);
  readonly confirm = signal<'delete' | 'import' | null>(null);
  readonly importName = signal('');
  readonly note = signal('');
  readonly error = signal('');

  providerLabel(): string {
    const stored = this.keys();
    if (!stored.length) return this.i18n.translate('common.none');
    if (stored.length === 1) return this.providerName(stored[0].provider);
    return String(stored.length);
  }

  providerName(id: AiProviderId): string {
    return this.providers.find((option) => option.id === id)?.label ?? '';
  }

  keyHint(secret: string): string {
    return keyHintFromSecret(secret);
  }

  draftReady(): boolean {
    return this.draftKey().trim().length > 0;
  }

  languageName(code: string): string {
    return languageDisplayName(code);
  }

  generalSupport(): string {
    return this.supportState().general;
  }

  supportLabel(): string {
    const general = this.generalSupport();
    return general ? this.languageName(general) : this.i18n.translate('common.none');
  }

  setGeneralSupport(value: string): void {
    writeGeneralSupportLanguage(value);
  }

  scoreColor(step: ScoreStep): string {
    return this.scoreColorMap()[step];
  }

  scoreColorsChanged(): boolean {
    const colors = this.scoreColorMap();
    return SCORE_STEPS.some((step) => colors[step] !== DEFAULT_SCORE_COLORS[step]);
  }

  setScoreColor(step: ScoreStep, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.scoreColorMap.set(writeScoreColor(step, value));
  }

  resetScoreColorEnds(): void {
    this.scoreColorMap.set(resetScoreColors());
  }

  toggle(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  appLanguageValue(): string {
    return this.i18n.hasUserOverride ? this.i18n.currentLanguage : 'device';
  }

  setAppLanguage(value: string): void {
    if (value === 'device') {
      this.i18n.resetAppLanguage();
      return;
    }
    this.i18n.setAppLanguage(value as LANGUAGE_CODE);
  }

  closeOnBackdrop(event: Event): void {
    if (event.target !== event.currentTarget) return;
    if (this.keyDragging() || this.ignoreBackdropClick) return;
    this.back();
  }

  finishKeyDrag(): void {
    this.keyDragging.set(false);
    this.ignoreBackdropClick = true;
    setTimeout(() => {
      this.ignoreBackdropClick = false;
    });
  }

  toggleAddKey(): void {
    const open = !this.addOpen();
    this.addOpen.set(open);
    this.aiNotice.set(null);
    if (!open) this.draftKey.set('');
  }

  selectDraftProvider(value: string): void {
    if (!isAiProvider(value)) return;
    this.draftProvider.set(value);
  }

  async addKey(event?: Event): Promise<void> {
    event?.preventDefault();
    const apiKey = this.draftKey().trim();
    if (!apiKey || this.busyId()) return;
    this.busyId.set('add');
    this.aiNotice.set(null);
    try {
      addStoredAiKey(this.draftProvider(), apiKey);
      this.refreshKeys();
      this.draftKey.set('');
      this.addOpen.set(false);
      this.aiNotice.set({ key: 'settings.keyAdded', params: {}, error: false });
    } catch (err) {
      this.aiNotice.set({ key: this.aiFailure(err, 'settings.keyInvalid'), params: {}, error: true });
    } finally {
      this.busyId.set(null);
    }
  }

  removeKey(id: string): void {
    if (this.busyId()) return;
    removeStoredAiKey(id);
    this.refreshKeys();
    this.aiNotice.set({ key: 'settings.keyRemoved', params: {}, error: false });
  }

  dropKeys(event: CdkDragDrop<StoredAiKey[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.keys()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    reorderStoredAiKeys(next.map((key) => key.id));
    this.refreshKeys();
  }

  async testSaved(key: StoredAiKey): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(key.id);
    this.aiNotice.set(null);
    try {
      const sample = await testAiKey(key.provider, { apiKey: key.apiKey, model: key.model });
      this.aiNotice.set({ key: 'settings.testOk', params: { sample }, error: false });
    } catch (err) {
      this.aiNotice.set({ key: this.aiFailure(err, 'settings.testFailed'), params: {}, error: true });
    } finally {
      this.busyId.set(null);
    }
  }

  async testDraft(): Promise<void> {
    const apiKey = this.draftKey().trim();
    if (!apiKey || this.busyId()) return;
    this.busyId.set('add');
    this.aiNotice.set(null);
    try {
      const sample = await testAiKey(this.draftProvider(), { apiKey });
      this.aiNotice.set({ key: 'settings.testOk', params: { sample }, error: false });
    } catch (err) {
      this.aiNotice.set({ key: this.aiFailure(err, 'settings.testFailed'), params: {}, error: true });
    } finally {
      this.busyId.set(null);
    }
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
      this.error.set('settings.copyFailed');
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
        const languages = await replaceCollection(data.elements, data.catalog, data.translations);
        this.job.forget();
        for (const language of languages) this.job.invalidate(language);
        this.importFile = null;
        this.importName.set('');
        this.confirm.set(null);
        this.note.set('settings.imported');
        this.changed.emit();
      } catch {
        this.error.set('settings.saveFailed');
      }
    } catch {
      this.error.set('settings.readFailed');
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
      await replaceCollection([], emptyMetadataIndexes(), []);
      this.job.forget();
      this.confirm.set(null);
      this.note.set('settings.deleted');
      this.changed.emit();
    } catch {
      this.error.set('settings.deleteFailed');
    } finally {
      this.busy.set(false);
    }
  }

  back(): void {
    this.closed.emit();
  }

  private refreshKeys(): void {
    this.keys.set(readStoredAiCredentials().keys);
  }

  private aiFailure(err: unknown, fallback: string): string {
    const code = err instanceof AiError ? err.code : '';
    if (code === AI_ERROR.PROVIDER_AUTH_FAILED) return 'settings.keyAuthFailed';
    if (code === AI_ERROR.CREDENTIALS_ALREADY_CONFIGURED) return 'settings.keyDuplicate';
    if (code === AI_ERROR.CREDENTIALS_INVALID) return 'settings.keyInvalid';
    return fallback;
  }
}
