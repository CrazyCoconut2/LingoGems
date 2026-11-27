import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '../i18n/translate.pipe';
import { LanguageService } from '../i18n/language.service';
import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  displayTitle,
  languageDisplayName,
  parsePassage,
  type ElementMetadata,
  type ParsedPassage,
} from 'collection';
import { readFieldColor } from './metadata-colors';
import { PhraseTranslation } from '../translate/phrase-translation';
import { supportLanguageFor } from '../languages/translation-language';
import {
  emptyDailyGoals,
  readDailyGoals,
  readGoalInput,
  writeDailyGoals,
  type DailyGoals,
} from './stats-goals';
import { type StatsView } from './stats-cache';
import { StatsJob } from './stats-job';
import { ignoreMissingToken, readMissingBlacklist, restoreMissingToken } from './stats-missing';
import type { DayStats, ElementDayStats, MissingToken } from './stats.worker';

type ActivityKey = 'seen' | 'added' | 'exercises';

const ACTIVITIES: readonly {
  key: ActivityKey;
  label: string;
  goal: string;
}[] = [
  { key: 'seen', label: 'stats.seen', goal: 'stats.goalSeen' },
  { key: 'added', label: 'stats.added', goal: 'stats.goalAdded' },
  { key: 'exercises', label: 'stats.exercises', goal: 'stats.goalExercises' },
];

type ElementSort = { kind: 'exercises' } | { kind: 'differential' } | { kind: 'seen' };

type GoalKind = keyof DailyGoals;

const LOADING_ACTIVITY = [0, 1, 2];
const LOADING_ROWS = [0, 1, 2, 3];

export type MissingPreviewSense = {
  text: string;
  metadata: ElementMetadata;
  equivalent?: string;
  example?: string;
};

/** A generated element waiting in the missing list. */
export type MissingPreview = {
  key: string;
  title: string;
  lemma: string;
  senses: MissingPreviewSense[];
  /** Set once the user adds it, until the row leaves the list. */
  collectedId: string;
};

const EMPTY_DAY: DayStats = {
  day: '',
  added: 0,
  revealed: 0,
  exercises: 0,
  seen: 0,
  differential: 0,
  elements: [],
};

@Component({
  selector: 'app-stats',
  imports: [NgTemplateOutlet, PhraseTranslation, TranslatePipe],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'stats.title' | translate"
      [attr.aria-busy]="pending() ? true : null"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div class="header-bar">
            <div>
              <h2>{{ 'stats.title' | translate }}</h2>
              <p class="language">
                <span>{{ languageName() }}</span>
                @if (error()) {
                  <span class="failed">{{ 'stats.failed' | translate }}</span>
                }
              </p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="icon-btn"
                [class.on]="stale()"
                [attr.aria-label]="(stale() ? 'stats.update' : 'stats.recompile') | translate"
                [attr.title]="(stale() ? 'stats.update' : 'stats.recompile') | translate"
                (click)="recompile()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                [class.on]="goalsOpen()"
                [attr.aria-label]="'stats.dailyGoals' | translate"
                [attr.aria-expanded]="goalsOpen()"
                (click)="toggleGoals()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                [attr.aria-label]="'common.close' | translate"
                (click)="closed.emit()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div class="day-nav">
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="'stats.olderDay' | translate"
              [disabled]="pending() || !canGoOlder()"
              (click)="older()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            @if (pending()) {
              <p class="day"><span class="bone bone-day"></span></p>
            } @else {
              <div class="day-center">
                <p class="day">{{ dayLabel() || '—' }}</p>
                @if (viewingToday() && streak() > 0) {
                  <span
                    class="streak"
                    [attr.aria-label]="streakLabel()"
                    [attr.title]="streakLabel()"
                  >
                    <svg class="flame" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-3 3-4 2z"
                      />
                    </svg>
                    <span class="streak-count">{{ formatCount(streak()) }}</span>
                  </span>
                }
              </div>
            }
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="'stats.newerDay' | translate"
              [disabled]="pending() || !canGoNewer()"
              (click)="newer()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </header>
        <div class="body">
          @if (pending()) {
            <div class="loading" aria-hidden="true">
              <section class="block">
                <ul class="score">
                  <li class="loading-card">
                    <span class="bone bone-count"></span>
                    <span class="bone bone-caption"></span>
                  </li>
                </ul>
              </section>
              <section class="block">
                <div class="block-head">
                  <h3>{{ 'stats.activity' | translate }}</h3>
                </div>
                <ul class="activity">
                  @for (item of loadingActivity; track item) {
                    <li class="loading-card">
                      <span class="bone bone-well"></span>
                      <span class="bone bone-count"></span>
                      <span class="bone bone-caption"></span>
                    </li>
                  }
                </ul>
              </section>
              <section class="block deck">
                <div class="block-head">
                  <h3>{{ 'stats.elements' | translate }}</h3>
                </div>
                <ul class="elements">
                  @for (item of loadingRows; track item) {
                    <li class="row">
                      <span class="bone bone-title"></span>
                    </li>
                  }
                </ul>
              </section>
            </div>
          } @else if (ready()) {
            <section class="block">
              <ul class="score">
                <li
                  [class.up]="shown().differential > 0"
                  [class.down]="shown().differential < 0"
                  [attr.aria-label]="scoreLabel(shown().differential)"
                  [attr.title]="scoreLabel(shown().differential)"
                >
                  <span class="count">{{ formatDiff(shown().differential) }}</span>
                  <span class="caption">{{ 'stats.score' | translate }}</span>
                </li>
              </ul>
            </section>
            <section class="block">
              <div class="block-head">
                <h3>{{ 'stats.activity' | translate }}</h3>
              </div>
              <ul class="activity">
                @for (row of activities; track row.key) {
                  <li
                    [attr.aria-label]="activityCardLabel(row.key, shown()[row.key])"
                    [attr.title]="activityCardLabel(row.key, shown()[row.key])"
                  >
                    <span class="well" aria-hidden="true">
                      @if (row.key === 'exercises') {
                        <ng-container *ngTemplateOutlet="exerciseIcon" />
                      } @else {
                        <ng-container
                          *ngTemplateOutlet="activityIcon; context: { $implicit: row.key }"
                        />
                      }
                    </span>
                    <span class="count">{{ formatCount(shown()[row.key]) }}</span>
                    <span class="caption">{{ row.label | translate }}</span>
                    @if (goalsOpen() || goals()[row.key] !== null) {
                      <div class="card-foot">
                        @if (goalsOpen()) {
                          <span class="card-goal-label">{{ 'stats.goal' | translate }}</span>
                          <ng-container
                            *ngTemplateOutlet="
                              goalStepper;
                              context: { kind: row.key, label: row.goal }
                            "
                          />
                        }
                        @if (goals()[row.key]; as goal) {
                          <div
                            class="meter"
                            role="progressbar"
                            aria-valuemin="0"
                            [attr.aria-valuenow]="meterNow(shown()[row.key], goal)"
                            [attr.aria-valuemax]="goal"
                            [attr.aria-label]="meterLabel(row.key, goal)"
                          >
                            <span class="meter-track">
                              <span
                                class="meter-fill"
                                [style.width.%]="meterPercent(shown()[row.key], goal)"
                              ></span>
                            </span>
                            <span class="meter-label">{{ meterText(shown()[row.key], goal) }}</span>
                          </div>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
            <section class="block deck">
              <div class="block-head elements-head">
                <button
                  type="button"
                  class="fold"
                  [class.open]="elementsOpen()"
                  [attr.aria-expanded]="elementsOpen()"
                  (click)="elementsOpen.update((open) => !open)"
                >
                  <svg class="fold-chevron" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span class="fold-title">{{ 'stats.elements' | translate }}</span>
                  <span class="fold-count">{{ formatCount(sortedElements().length) }}</span>
                </button>
                <div class="sort-menu">
                  <button
                    type="button"
                    class="icon-btn"
                    [class.on]="sortMenuOpen() || elementSort()"
                    [attr.aria-expanded]="sortMenuOpen()"
                    [attr.aria-label]="'stats.sortElements' | translate"
                    [attr.title]="'stats.sort' | translate"
                    (click)="toggleSortMenu($event)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m3 8 4-4 4 4" />
                      <path d="M7 4v16" />
                      <path d="m21 16-4 4-4-4" />
                      <path d="M17 20V4" />
                    </svg>
                  </button>
                  @if (sortMenuOpen()) {
                    <div
                      class="sort-popover"
                      [class.above]="sortMenuAbove()"
                      role="listbox"
                      [attr.aria-label]="'stats.sortElements' | translate"
                      [style.max-height.px]="sortMenuMax()"
                      (click)="$event.stopPropagation()"
                    >
                      @for (option of elementSortOptions; track option.id) {
                        <button
                          type="button"
                          class="popover-option"
                          role="option"
                          [class.selected]="isSort(option.sort)"
                          [attr.aria-selected]="isSort(option.sort)"
                          (click)="chooseElementSort(option.sort)"
                        >
                          {{ option.label | translate }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
              @if (elementsOpen()) {
                <ul class="elements">
                  @for (element of sortedElements(); track element.id) {
                    <li>
                      <button
                        type="button"
                        class="row"
                        [class.has-new]="element.added > 0"
                        [attr.aria-label]="titleOf(element)"
                        (click)="opened.emit(element.id)"
                      >
                        @if (element.added > 0) {
                          <span class="new-sign">{{ 'stats.new' | translate }}</span>
                        }
                        <div class="row-main">
                          <span class="title" [attr.title]="titleOf(element)">{{
                            titleOf(element)
                          }}</span>
                          <span class="bits" [class.focused]="!!elementSort()">
                            @if (element.exercises > 0) {
                              <span
                                class="bit"
                                [class.on]="isSort(exerciseSort)"
                                [attr.aria-label]="exerciseLabel(element.exercises)"
                                [attr.title]="exerciseLabel(element.exercises)"
                              >
                                <ng-container *ngTemplateOutlet="exerciseIcon" />
                                <span>{{ formatCount(element.exercises) }}</span>
                              </span>
                            }
                            @if (element.seen > 0) {
                              <span
                                class="bit"
                                [class.on]="isSort(seenSort)"
                                [attr.aria-label]="activityLabel('seen', element.seen)"
                                [attr.title]="activityLabel('seen', element.seen)"
                              >
                                <ng-container
                                  *ngTemplateOutlet="activityIcon; context: { $implicit: 'seen' }"
                                />
                                <span>{{ formatCount(element.seen) }}</span>
                              </span>
                            }
                          </span>
                        </div>
                        @if (visibleDiff(element.differential); as diff) {
                          <span
                            class="row-score"
                            [class.up]="diff > 0"
                            [class.down]="diff < 0"
                            [class.on]="isSort(differentialSort)"
                            [attr.aria-label]="scoreLabel(diff)"
                            [attr.title]="scoreLabel(diff)"
                          >
                            {{ formatDiff(diff) }}
                          </span>
                        }
                      </button>
                    </li>
                  }
                </ul>
                @if (!sortedElements().length) {
                  <p class="hint elements-empty">{{ 'stats.nothing' | translate }}</p>
                }
              }
            </section>
            @if (visibleMissing().length || hiddenTokens().length) {
              <section class="block">
                <div class="block-head">
                  <button
                    type="button"
                    class="fold"
                    [class.open]="missingOpen()"
                    [attr.aria-expanded]="missingOpen()"
                    (click)="missingOpen.update((open) => !open)"
                  >
                    <svg class="fold-chevron" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span class="fold-title">{{ 'stats.missing' | translate }}</span>
                    <span class="fold-count">{{ formatCount(visibleMissing().length) }}</span>
                  </button>
                </div>
                @if (missingOpen()) {
                  @if (askError()) {
                    <p class="hint missing-error">{{ askError() | translate }}</p>
                  }
                  <ul class="elements">
                    @for (token of visibleMissing(); track token.key) {
                      <li>
                        @if (previewFor(token); as preview) {
                          <article class="card" [class.collected]="!!preview.collectedId">
                            <div class="card-head">
                              @if (preview.collectedId) {
                                <button
                                  type="button"
                                  class="card-title"
                                  [attr.aria-label]="
                                    'stats.open' | translate: { title: label(preview.lemma) }
                                  "
                                  (click)="opened.emit(preview.collectedId)"
                                >
                                  {{ label(preview.lemma) }}
                                </button>
                                <span class="tile-mark" aria-hidden="true">
                                  <svg viewBox="0 0 24 24">
                                    <path d="M20 6 9 17l-5-5" />
                                  </svg>
                                </span>
                              } @else {
                                <span class="card-title">{{ label(preview.lemma) }}</span>
                                <button
                                  type="button"
                                  class="tile-add"
                                  [attr.aria-label]="'common.add' | translate"
                                  [attr.title]="'common.add' | translate"
                                  [disabled]="asking()"
                                  [attr.aria-busy]="busyToken(token.key) ? true : null"
                                  (click)="addMissing.emit()"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M5 12h14" />
                                    <path d="M12 5v14" />
                                  </svg>
                                </button>
                              }
                              <button
                                type="button"
                                class="icon-btn"
                                [attr.aria-label]="'common.remove' | translate"
                                [attr.title]="'common.remove' | translate"
                                [disabled]="asking()"
                                (click)="hideMissing(token)"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                            <ol class="senses">
                              @for (sense of preview.senses; track $index) {
                                <li>
                                  @let passage = sensePassage(sense);
                                  @if (passage.text) {
                                    <p class="sense-text">
                                      {{ passage.text }}
                                      @if (supportLanguage()) {
                                        <app-phrase-translation
                                          [phrase]="passage.text"
                                          [sourceLang]="language()"
                                          [targetLang]="supportLanguage()"
                                          [equivalent]="sense.equivalent ?? ''"
                                        />
                                      }
                                    </p>
                                  }
                                  @if (examplePassage(sense); as example) {
                                    <div class="sense-example">
                                      @if (example.text) {
                                        <p class="sense-example-text">
                                          {{ example.text }}
                                          @if (supportLanguage()) {
                                            <app-phrase-translation
                                              [phrase]="example.text"
                                              [sourceLang]="language()"
                                              [targetLang]="supportLanguage()"
                                            />
                                          }
                                        </p>
                                      }
                                    </div>
                                  }
                                  @let meta = senseMeta(sense);
                                  @let equivalentPill =
                                    sense.equivalent && (!passage.text || !supportLanguage());
                                  @if (equivalentPill || meta.length) {
                                    <ul class="sense-meta">
                                      @if (equivalentPill) {
                                        <li class="sense-equivalent">
                                          <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="m5 8 6 6" />
                                            <path d="m4 14 6-6 2-3" />
                                            <path d="M2 5h12" />
                                            <path d="M7 2h1" />
                                            <path d="m22 22-5-10-5 10" />
                                            <path d="M14 18h6" />
                                          </svg>
                                          <span>{{ sense.equivalent }}</span>
                                        </li>
                                      }
                                      @for (entry of meta; track entry.key) {
                                        <li
                                          [class.colored]="entry.color"
                                          [style.--meta-color]="entry.color"
                                        >
                                          <span class="sense-meta-key">{{
                                            metaLabel(entry.key)
                                          }}</span>
                                          <span class="sense-meta-value">{{
                                            metaLabel(entry.value)
                                          }}</span>
                                        </li>
                                      }
                                    </ul>
                                  }
                                </li>
                              }
                            </ol>
                          </article>
                        } @else {
                          <div class="row missing-row">
                            <div class="row-main">
                              <span class="title" [attr.title]="token.title">{{
                                token.title
                              }}</span>
                              <span class="bits">
                                <span
                                  class="bit"
                                  [attr.aria-label]="translatedLabel(token.seen)"
                                  [attr.title]="translatedLabel(token.seen)"
                                >
                                  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m5 8 6 6" />
                                    <path d="m4 14 6-6 2-3" />
                                    <path d="M2 5h12" />
                                    <path d="M7 2h1" />
                                    <path d="m22 22-5-10-5 10" />
                                    <path d="M14 18h6" />
                                  </svg>
                                  <span>{{ formatCount(token.seen) }}</span>
                                </span>
                              </span>
                            </div>
                            <div class="missing-actions">
                              <button
                                type="button"
                                class="icon-btn"
                                [attr.aria-label]="'languages.askAi' | translate"
                                [attr.title]="'languages.askAi' | translate"
                                [disabled]="asking()"
                                [attr.aria-busy]="busyToken(token.key) ? true : null"
                                (click)="askMissing.emit({ key: token.key, title: token.title })"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                class="icon-btn"
                                [attr.aria-label]="'common.remove' | translate"
                                [attr.title]="'common.remove' | translate"
                                [disabled]="asking()"
                                (click)="hideMissing(token)"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        }
                      </li>
                    }
                    @if (hiddenTokens().length) {
                      <li class="hidden-row">
                        <button
                          type="button"
                          class="hidden-toggle"
                          [class.open]="hiddenOpen()"
                          [attr.aria-expanded]="hiddenOpen()"
                          (click)="hiddenOpen.update((open) => !open)"
                        >
                          <svg class="fold-chevron" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                          <span class="fold-title">{{ 'stats.hidden' | translate }}</span>
                          <span class="fold-count">{{ formatCount(hiddenTokens().length) }}</span>
                        </button>
                        @if (hiddenOpen()) {
                          <ul class="hidden-list">
                            @for (token of hiddenTokens(); track token.key) {
                              <li class="missing-row">
                                <div class="row-main">
                                  <span class="title" [attr.title]="token.title">{{
                                    token.title
                                  }}</span>
                                  <span class="bits">
                                    <span
                                      class="bit"
                                      [attr.aria-label]="translatedLabel(token.seen)"
                                      [attr.title]="translatedLabel(token.seen)"
                                    >
                                      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="m5 8 6 6" />
                                        <path d="m4 14 6-6 2-3" />
                                        <path d="M2 5h12" />
                                        <path d="M7 2h1" />
                                        <path d="m22 22-5-10-5 10" />
                                        <path d="M14 18h6" />
                                      </svg>
                                      <span>{{ formatCount(token.seen) }}</span>
                                    </span>
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  class="restore"
                                  [attr.aria-label]="
                                    'stats.restoreNamed' | translate: { title: token.title }
                                  "
                                  (click)="restoreMissing(token.key)"
                                >
                                  {{ 'common.restore' | translate }}
                                </button>
                              </li>
                            }
                          </ul>
                        }
                      </li>
                    }
                  </ul>
                }
              </section>
            }
          }
        </div>
      </section>
    </div>
    <ng-template #goalStepper let-kind="kind" let-label="label">
      <div class="count-stepper">
        <button
          type="button"
          [attr.aria-label]="'stats.decreaseGoal' | translate: { label: (label | translate) }"
          [disabled]="!goalSet(kind)"
          (click)="stepGoal(kind, -1)"
        >
          −
        </button>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          [attr.aria-label]="'stats.dailyGoal' | translate: { label: (label | translate) }"
          placeholder="–"
          [value]="goalValue(kind)"
          (change)="commitGoal(kind, $event)"
        />
        <button
          type="button"
          [attr.aria-label]="'stats.increaseGoal' | translate: { label: (label | translate) }"
          (click)="stepGoal(kind, 1)"
        >
          +
        </button>
      </div>
    </ng-template>
    <ng-template #exerciseIcon>
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999" />
        <path
          d="M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024"
        />
        <path
          d="M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069"
        />
        <path
          d="M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z"
        />
      </svg>
    </ng-template>
    <ng-template #activityIcon let-key>
      @switch (key) {
        @case ('added') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        }
        @case ('seen') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      }
    </ng-template>
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

    .panel,
    .panel * {
      box-sizing: border-box;
    }

    .panel {
      width: min(36rem, 100%);
      height: min(40rem, calc(100dvh - 2.5rem));
      max-height: min(40rem, calc(100dvh - 2.5rem));
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

    .panel-header {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      flex-shrink: 0;
      padding: 0.9rem 0.7rem 0.45rem;
      border-bottom: 1px solid var(--border);
    }

    .header-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0 0.3rem;
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

    .panel-header p {
      margin-top: 0.15rem;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .language {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem 0.6rem;
    }

    .language .failed {
      color: var(--danger);
    }

    .actions {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
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

    .icon-btn:hover:not(:disabled) {
      background: rgba(139, 144, 165, 0.16);
      color: var(--text);
    }

    .icon-btn.on {
      background: rgba(255, 51, 102, 0.12);
      color: #ff3366;
    }

    .icon-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .icon-btn:focus-visible {
      outline: 2px solid rgba(var(--accent-rgb), 0.7);
      outline-offset: 2px;
    }

    .icon-btn svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .body {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      flex: 1;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .body > section:last-child {
      padding-bottom: 1rem;
    }

    .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .day-nav {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0 0.1rem;
    }

    .panel-header .day {
      margin: 0;
      color: var(--text);
      text-align: center;
      font-size: 1.05rem;
      font-weight: 720;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .day-center {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .day-center .day {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .streak {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      flex: none;
      padding: 0.16rem 0.42rem 0.16rem 0.28rem;
      border-radius: 999px;
      background: rgba(255, 122, 26, 0.14);
      color: #ff7a1a;
      box-shadow: inset 0 0 0 1px rgba(255, 122, 26, 0.38);
    }

    .streak .flame {
      width: 0.92rem;
      height: 0.92rem;
    }

    .streak-count {
      color: #ffc49a;
      font-size: 0.84rem;
      font-weight: 720;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      line-height: 1;
    }

    .count-stepper {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex: none;
    }

    .count-stepper button {
      display: grid;
      place-items: center;
      width: 1.8rem;
      height: 1.8rem;
      border: 0;
      border-radius: 0.55rem;
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      color: var(--text);
      font: inherit;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .count-stepper button:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.1);
    }

    .count-stepper button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .count-stepper input {
      width: 2.7rem;
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.84rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      padding: 0;
    }

    .count-stepper input::placeholder {
      color: var(--text-muted);
      font-weight: 650;
    }

    .count-stepper input:focus {
      outline: 2px solid rgba(var(--accent-rgb), 0.55);
      outline-offset: 2px;
      border-radius: 0.2rem;
    }

    .meter {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      color: var(--goal, var(--text));
    }

    .meter-track {
      flex: 1;
      height: 0.42rem;
      min-width: 0;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.4);
    }

    .meter-fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: currentColor;
      transition: width 0.2s ease;
    }

    .meter-label {
      flex: none;
      color: inherit;
      font-size: 0.62rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }

    .block h3 {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .block {
      flex-shrink: 0;
      min-width: 0;
      padding: 0.95rem 1rem 0;
    }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      min-width: 0;
      margin-bottom: 0.5rem;
    }

    .elements-head {
      align-items: center;
    }

    .sort-menu {
      position: relative;
      flex-shrink: 0;
    }

    .sort-menu .icon-btn.on {
      background: #1b2136;
      color: #d8b4fe;
    }

    .sort-popover {
      position: absolute;
      right: 0;
      top: calc(100% + 0.28rem);
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 12.5rem;
      overflow: auto;
      padding: 0.55rem;
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      background: var(--surface);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
    }

    .sort-popover.above {
      top: auto;
      bottom: calc(100% + 0.28rem);
    }

    .popover-option {
      display: block;
      width: 100%;
      padding: 0.45rem 0.5rem;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.8rem;
      text-align: left;
      cursor: pointer;
    }

    .popover-option:hover {
      background: var(--surface-2);
    }

    .popover-option.selected {
      background: rgba(var(--accent-rgb), 0.14);
      color: var(--accent-text);
      font-weight: 650;
    }

    .score,
    .activity,
    .elements {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .score,
    .activity {
      display: grid;
      gap: 0.45rem;
    }

    .activity {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .score li,
    .activity li {
      min-width: 0;
    }

    .score li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.12rem;
      padding: 0.85rem 0.55rem 0.7rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
    }

    .score .count {
      color: var(--text-muted);
      font-size: 1.65rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .score li.up .count {
      color: var(--score-10);
    }

    .score li.down .count {
      color: var(--score-1);
    }

    .card-foot {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.4rem;
      align-self: stretch;
      width: 100%;
      margin-top: auto;
      padding-top: 0.45rem;
    }

    .card-goal-label {
      display: block;
      color: var(--text-muted);
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1;
      text-align: center;
      text-transform: uppercase;
    }

    .card-foot .count-stepper {
      justify-content: center;
      gap: 0.12rem;
    }

    .card-foot .count-stepper button {
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 0.4rem;
      background: color-mix(in srgb, var(--goal, var(--text)) 18%, rgba(6, 8, 16, 0.72));
      color: var(--goal, var(--text));
      font-size: 0.85rem;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--goal, var(--text)) 42%, transparent);
    }

    .card-foot .count-stepper button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--goal, var(--text)) 30%, rgba(6, 8, 16, 0.72));
    }

    .card-foot .count-stepper input {
      width: 1.7rem;
      color: var(--goal, var(--text));
      font-size: 0.78rem;
    }

    .card-foot .count-stepper input::placeholder {
      color: color-mix(in srgb, var(--goal, var(--text)) 50%, transparent);
    }

    .activity .well {
      display: grid;
      place-items: center;
      width: 2.35rem;
      height: 2.35rem;
      margin-bottom: 0.28rem;
      border-radius: 0.7rem;
      background: rgba(8, 10, 18, 0.45);
      color: var(--text-muted);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    }

    .activity .well .mark {
      width: 1.45rem;
      height: 1.45rem;
    }

    .score .caption,
    .activity .caption {
      max-width: 100%;
      color: var(--text-muted);
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }

    .activity li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.12rem;
      padding: 0.8rem 0.4rem 0.65rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
      color: var(--text-muted);
    }

    .activity li:has(.card-foot) {
      align-items: stretch;
    }

    .activity li:has(.card-foot) .well,
    .activity li:has(.card-foot) .count,
    .activity li:has(.card-foot) .caption {
      align-self: center;
    }

    .activity .meter {
      align-self: stretch;
      width: 100%;
    }

    .flame {
      display: block;
      width: 1.45rem;
      height: 1.45rem;
      fill: currentColor;
    }

    .activity .count {
      color: var(--text);
      font-size: 1.55rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .mark {
      display: block;
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .deck {
      display: flex;
      flex: none;
      flex-direction: column;
    }

    .elements {
      display: flex;
      flex-direction: column;
      align-content: flex-start;
      gap: 0.4rem;
      flex: none;
      margin: 0;
      padding: 0;
    }

    .elements-empty {
      margin: 0.15rem 0 0;
    }

    .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.7rem;
      max-width: 100%;
      padding: 0.7rem 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
    }

    button.row {
      width: 100%;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }

    button.row:hover {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.04);
    }

    .row-main {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 0.28rem;
      min-width: 0;
    }

    .title {
      align-self: stretch;
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      font-size: 0.92rem;
      font-weight: 680;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row.has-new .title {
      padding-right: 2.6rem;
    }

    .bits {
      display: flex;
      flex: none;
      flex-flow: row wrap;
      align-items: center;
      gap: 0.45rem;
      min-height: 0.92rem;
      line-height: 1;
    }

    .bit {
      display: inline-flex;
      align-items: center;
      gap: 0.14rem;
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .bits.focused .bit:not(.on) {
      opacity: 0.32;
    }

    .bit.on {
      color: var(--accent-text);
    }

    .row-score {
      flex: none;
      margin-left: auto;
      color: var(--text-muted);
      font-size: 0.92rem;
      font-weight: 720;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      line-height: 1;
    }

    .row-score.up {
      color: var(--score-10);
    }

    .row-score.down {
      color: var(--score-1);
    }

    .bits.focused ~ .row-score:not(.on) {
      opacity: 0.32;
    }

    .row-score.on {
      color: var(--accent-text);
    }

    .missing-row {
      gap: 0.45rem;
      border-color: rgba(255, 255, 255, 0.04);
      background: color-mix(in srgb, var(--surface-2) 55%, var(--bg));
    }

    .missing-row .title,
    .missing-row .bit {
      color: var(--text-muted);
    }

    .missing-actions {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
    }

    .card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      min-width: 0;
      max-width: 100%;
      margin: 0;
      padding: 0.85rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
      color: var(--text);
    }

    .card.collected {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--surface-2);
      box-shadow: 0 0 16px -2px color-mix(in srgb, var(--accent) 45%, transparent);
    }

    .card-head {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .card-title {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: white;
      padding: 0;
      font: inherit;
      font-size: 1.125rem;
      font-weight: 750;
      line-height: 1.2;
      letter-spacing: -0.02em;
      text-align: left;
      overflow-wrap: anywhere;
    }

    button.card-title {
      cursor: pointer;
    }

    .senses {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sense-text {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.45;
    }

    .sense-meta li.sense-equivalent {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      max-width: 100%;
      border-radius: 999px;
      border-color: var(--accent-border);
      background: var(--accent-soft);
      color: var(--text);
      font-size: 0.75rem;
      font-style: normal;
      font-weight: 600;
    }

    .sense-meta li.sense-equivalent svg {
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      fill: none;
      stroke: var(--accent-text);
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sense-example {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      margin-top: 0.45rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--surface-2) 90%, transparent);
    }

    .sense-example-text {
      margin: 0;
      color: #e2e8f0;
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.5;
    }

    .sense-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.35rem 0 0;
      padding: 0;
      list-style: none;
    }

    .sense-meta li {
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 0.5rem;
      background: var(--bg);
      padding: 0.25rem 0.625rem;
      font-size: 0.6875rem;
      line-height: 1.2;
    }

    .sense-meta li.colored {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: color-mix(in srgb, var(--meta-color) 30%, var(--surface-2));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--meta-color) 62%, transparent);
      color: var(--meta-color);
    }

    .sense-meta-key {
      margin-right: 0.25rem;
      color: var(--text-muted);
      font-weight: 700;
    }

    .sense-meta li.colored .sense-meta-key {
      margin-right: 0;
      color: var(--meta-color);
    }

    .sense-meta-value {
      color: var(--text);
      font-weight: 650;
    }

    .tile-add,
    .tile-mark {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.55rem;
      height: 1.55rem;
      color: var(--accent-text);
    }

    .tile-add {
      border: 0;
      border-radius: 999px;
      padding: 0;
      background: rgba(var(--accent-rgb), 0.16);
      cursor: pointer;
    }

    .tile-add:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .tile-add svg,
    .tile-mark svg {
      display: block;
      width: 0.85rem;
      height: 0.85rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .hidden-row {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .fold,
    .hidden-toggle {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      margin: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: 0.84rem;
      line-height: 1.2;
      cursor: pointer;
    }

    .fold {
      padding: 0;
    }

    .hidden-toggle {
      align-self: flex-start;
      padding: 0.35rem 0.15rem 0.35rem 0;
    }

    .fold-title {
      color: var(--text);
      font-weight: 600;
    }

    .fold-count {
      color: #94a3b8;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .fold:hover .fold-count,
    .hidden-toggle:hover .fold-count,
    .fold:hover .fold-chevron,
    .hidden-toggle:hover .fold-chevron {
      color: var(--text);
    }

    .fold-chevron {
      align-self: center;
      width: 0.85rem;
      height: 0.85rem;
      flex: none;
      color: #94a3b8;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition:
        transform 0.18s ease,
        color 0.18s ease;
    }

    .fold.open .fold-chevron,
    .hidden-toggle.open .fold-chevron {
      transform: rotate(90deg);
    }

    .hidden-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .hidden-list li {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
      padding: 0.7rem 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 1rem;
      background: color-mix(in srgb, var(--surface-2) 55%, var(--bg));
    }

    .restore {
      flex-shrink: 0;
      margin: 0;
      padding: 0.2rem 0.15rem;
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.75rem;
      font-weight: 650;
      cursor: pointer;
    }

    .restore:hover {
      color: var(--text);
    }

    .missing-error {
      margin: 0 0 0.55rem;
      color: var(--danger);
    }

    .new-sign {
      position: absolute;
      top: 0.55rem;
      right: 0.6rem;
      display: inline-flex;
      align-items: center;
      padding: 0.16rem 0.38rem;
      border-radius: 999px;
      background: var(--danger);
      color: #fff;
      font-size: 0.6rem;
      font-weight: 750;
      letter-spacing: 0.05em;
      line-height: 1;
      text-transform: uppercase;
    }

    .bit .mark {
      display: block;
      width: 0.92rem;
      height: 0.92rem;
      flex: none;
      margin: 0;
    }

    .bone {
      display: block;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 10%, transparent);
    }

    .bone-day {
      width: 9.5rem;
      height: 0.9rem;
      margin-inline: auto;
    }

    .score li.loading-card,
    .activity li.loading-card {
      border-color: var(--border);
      background: rgba(255, 255, 255, 0.03);
    }

    .bone-well {
      width: 2.35rem;
      height: 2.35rem;
      margin-bottom: 0.28rem;
      border-radius: 0.7rem;
    }

    .bone-count {
      width: 2.6rem;
      height: 1.2rem;
    }

    .bone-caption {
      width: 4.2rem;
      height: 0.5rem;
      margin-top: 0.2rem;
    }

    .loading .bone-title {
      width: 58%;
      height: 1.05rem;
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .panel {
        width: 100%;
        height: min(40rem, calc(100dvh - 1.3rem));
        max-height: min(40rem, calc(100dvh - 1.3rem));
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class StatsModal {
  private readonly i18n = inject(LanguageService);
  readonly language = input.required<string>();
  readonly asking = input(false);
  readonly askingKey = input('');
  readonly askError = input('');
  readonly preview = input<MissingPreview | null>(null);
  readonly closed = output<void>();
  readonly opened = output<string>();
  readonly askMissing = output<{ key: string; title: string }>();
  readonly addMissing = output<void>();
  readonly dismissed = output<string>();
  readonly activities = ACTIVITIES;
  readonly loadingActivity = LOADING_ACTIVITY;
  readonly loadingRows = LOADING_ROWS;
  readonly goalsOpen = signal(false);
  readonly goals = signal<DailyGoals>(emptyDailyGoals());
  readonly blacklist = signal<string[]>([]);
  readonly elementsOpen = signal(true);
  readonly hiddenOpen = signal(false);
  readonly missingOpen = signal(false);
  readonly dayIndex = signal(0);
  readonly elementSort = signal<ElementSort | null>(null);
  readonly sortMenuOpen = signal(false);
  readonly sortMenuAbove = signal(false);
  readonly sortMenuMax = signal(280);
  readonly exerciseSort: ElementSort = { kind: 'exercises' };
  readonly differentialSort: ElementSort = { kind: 'differential' };
  readonly seenSort: ElementSort = { kind: 'seen' };
  readonly elementSortOptions: readonly { id: string; sort: ElementSort; label: string }[] = [
    { id: 'differential', sort: this.differentialSort, label: 'stats.sortScore' },
    { id: 'exercises', sort: this.exerciseSort, label: 'stats.sortExercised' },
    { id: 'seen', sort: this.seenSort, label: 'stats.sortSeen' },
  ];

  private readonly job = inject(StatsJob);
  /** False once this open window has a snapshot and should ignore later compiles. */
  private readonly following = signal(true);
  private readonly held = signal<StatsView | null>(null);
  private readonly heldRevision = signal(0);

  readonly live = computed(() => this.job.view(this.language()));
  readonly stats = computed(() => (this.following() ? this.live() : (this.held() ?? this.live())));
  readonly stale = computed(() => {
    if (this.following()) return false;
    return this.job.revision(this.language()) !== this.heldRevision();
  });
  readonly pending = computed(() => {
    const phase = this.stats().phase;
    return phase === 'pending' || (phase === 'empty' && this.language().trim().length > 0);
  });
  readonly ready = computed(() => this.stats().phase === 'ready');
  readonly error = computed(() => this.stats().phase === 'error');
  readonly snapshot = computed(() => this.stats().snapshot);
  readonly days = computed(() => {
    const days = this.snapshot()?.days;
    return days ? daysWithToday(days) : [];
  });
  readonly day = computed(() => this.days()[this.dayIndex()] ?? null);
  readonly shown = computed(() => this.day() ?? EMPTY_DAY);
  readonly visibleMissing = computed(() => {
    const hidden = new Set(this.blacklist());
    return (this.snapshot()?.missing ?? []).filter((token) => !hidden.has(token.key));
  });
  readonly hiddenTokens = computed(() => {
    const language = this.language();
    const seen = new Map((this.snapshot()?.missing ?? []).map((token) => [token.key, token.seen]));
    return this.blacklist().map((key) => ({
      key,
      title: displayTitle(key, language) || key,
      seen: seen.get(key) ?? 0,
    }));
  });
  readonly sortedElements = computed(() => {
    const language = this.language();
    const sort = this.elementSort();
    const elements = [...(this.day()?.elements ?? [])];
    elements.sort((left, right) => compareElements(left, right, sort, language));
    return elements;
  });
  readonly canGoOlder = computed(() => this.dayIndex() < this.days().length - 1);
  readonly canGoNewer = computed(() => this.dayIndex() > 0);
  dayLabel(): string {
    const current = this.day();
    return current ? formatDay(current.day, this.i18n) : '';
  }

  dayBadge(): string {
    const current = this.day();
    return current ? formatDayBadge(current.day, this.i18n) : '';
  }
  readonly viewingToday = computed(() => {
    const current = this.day();
    return !!current && isToday(current.day);
  });
  readonly streak = computed(() => {
    if (!this.viewingToday()) return 0;
    const days = this.snapshot()?.days ?? [];
    return streakLength(days.map((day) => day.day));
  });

  constructor() {
    effect(() => {
      const language = this.language();
      untracked(() => {
        this.following.set(true);
        this.held.set(null);
        this.heldRevision.set(0);
        this.dayIndex.set(0);
        this.elementSort.set(null);
        this.sortMenuOpen.set(false);
        this.goalsOpen.set(false);
        this.goals.set(readDailyGoals(language));
        this.blacklist.set(readMissingBlacklist(language));
        this.elementsOpen.set(true);
        this.hiddenOpen.set(false);
        this.missingOpen.set(false);
        this.job.ensure(language);
      });
    });
    effect(() => {
      if (!this.following()) return;
      const language = this.language();
      const live = this.job.view(language);
      if (live.phase !== 'ready' && live.phase !== 'error') return;
      untracked(() => {
        this.held.set(live);
        this.heldRevision.set(this.job.revision(language));
        this.following.set(false);
      });
    });
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  @HostListener('document:click', ['$event'])
  closeSortMenu(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.sort-menu')) this.sortMenuOpen.set(false);
  }

  toggleSortMenu(event: Event): void {
    event.stopPropagation();
    const opening = !this.sortMenuOpen();
    if (opening && event.currentTarget instanceof HTMLElement) {
      const button = event.currentTarget.getBoundingClientRect();
      const body = event.currentTarget.closest('.body')?.getBoundingClientRect();
      const above = button.top - (body?.top ?? 0);
      const below = (body?.bottom ?? window.innerHeight) - button.bottom;
      this.sortMenuAbove.set(above > below);
      this.sortMenuMax.set(Math.max(120, Math.max(above, below) - 10));
    }
    this.sortMenuOpen.set(opening);
  }

  chooseElementSort(sort: ElementSort): void {
    this.sortMenuOpen.set(false);
    this.toggleSort(sort);
  }

  older(): void {
    if (!this.canGoOlder()) return;
    this.dayIndex.update((index) => index + 1);
  }

  newer(): void {
    if (!this.canGoNewer()) return;
    this.dayIndex.update((index) => index - 1);
  }

  isSort(sort: ElementSort): boolean {
    return sameElementSort(this.elementSort(), sort);
  }

  /** A gain that still reads as zero stays off the row. */
  visibleDiff(value: number | null): number | null {
    if (value == null || !Number.isFinite(value)) return null;
    const rounded = Math.round(value * 10) / 10;
    return rounded === 0 ? null : value;
  }

  toggleSort(sort: ElementSort): void {
    this.elementSort.update((current) => (sameElementSort(current, sort) ? null : sort));
  }

  toggleGoals(): void {
    this.goalsOpen.update((open) => !open);
  }

  /** Show the compile already in progress, or start one when the window is current. */
  recompile(): void {
    const language = this.language();
    const behind = !this.following() && this.job.revision(language) !== this.heldRevision();
    const live = this.job.view(language);
    this.following.set(true);
    if (behind && live.phase !== 'empty') return;
    this.job.invalidate(language);
  }

  goalSet(kind: GoalKind): boolean {
    return this.goals()[kind] != null;
  }

  goalValue(kind: GoalKind): string {
    const value = this.goals()[kind];
    return value == null ? '' : String(value);
  }

  stepGoal(kind: GoalKind, by: number): void {
    const current = this.goals()[kind] ?? 0;
    const next = current + by;
    if (!Number.isSafeInteger(next)) return;
    this.saveGoal(kind, next > 0 ? next : null);
  }

  commitGoal(kind: GoalKind, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const parsed = readGoalInput(input.value);
    if (!parsed.ok) {
      input.value = this.goalValue(kind);
      return;
    }
    this.saveGoal(kind, parsed.value);
  }

  meterNow(gain: number, goal: number): number {
    return Math.min(Math.max(gain, 0), goal);
  }

  meterPercent(gain: number, goal: number): number {
    if (goal <= 0) return 0;
    return (this.meterNow(gain, goal) / goal) * 100;
  }

  meterText(gain: number, goal: number): string {
    return `${this.formatCount(Math.max(gain, 0))} / ${this.formatCount(goal)}`;
  }

  meterLabel(key: ActivityKey, goal: number): string {
    const progress = this.meterText(this.shown()[key], goal);
    const label =
      key === 'seen'
        ? 'stats.seenMeter'
        : key === 'added'
          ? 'stats.addedMeter'
          : 'stats.exerciseMeter';
    return this.i18n.translate(label, { progress });
  }

  titleOf(element: ElementDayStats): string {
    return displayTitle(element.title, this.language());
  }

  languageName(): string {
    return languageDisplayName(this.language());
  }

  formatCount(count: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage).format(count);
  }

  formatDiff(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    const text = Math.abs(rounded).toFixed(1);
    if (rounded > 0) return `+${text}`;
    if (rounded < 0) return `−${text}`;
    return '0.0';
  }

  scoreLabel(value: number): string {
    return this.i18n.translate('stats.scoreDiff', { value: this.formatDiff(value) });
  }

  exerciseLabel(count: number): string {
    const amount = this.formatCount(count);
    return this.i18n.translate(count === 1 ? 'stats.exerciseOne' : 'stats.exerciseMany', {
      count: amount,
    });
  }

  activityLabel(key: ActivityKey, count: number): string {
    const name = this.activityName(key);
    return this.i18n.translate(count === 1 ? 'stats.oneName' : 'stats.countName', {
      count: this.formatCount(count),
      name,
    });
  }

  translatedLabel(count: number): string {
    const amount = this.formatCount(count);
    return this.i18n.translate(count === 1 ? 'stats.translatedOne' : 'stats.translatedMany', {
      count: amount,
    });
  }

  hideMissing(token: MissingToken): void {
    if (this.asking()) return;
    this.blacklist.set(ignoreMissingToken(this.language(), token.key));
    this.dismissed.emit(token.key);
  }

  previewFor(token: MissingToken): MissingPreview | null {
    const preview = this.preview();
    return preview?.key === token.key ? preview : null;
  }

  busyToken(key: string): boolean {
    return this.asking() && this.askingKey() === key;
  }

  supportLanguage(): string {
    return supportLanguageFor(this.language());
  }

  label(title: string): string {
    return displayTitle(title, this.language());
  }

  sensePassage(sense: MissingPreviewSense): ParsedPassage {
    const passage = parsePassage(sense.text);
    return { ...passage, text: displayTitle(passage.text, this.language()) };
  }

  examplePassage(sense: MissingPreviewSense): ParsedPassage | null {
    const raw = sense.example?.trim() ?? '';
    if (!raw) return null;
    const passage = parsePassage(raw);
    const text = displayTitle(passage.text, this.language());
    if (!text) return null;
    return { ...passage, text };
  }

  senseMeta(sense: MissingPreviewSense): { key: string; value: string; color: string | null }[] {
    return Object.entries(sense.metadata).map(([key, value]) => ({
      key,
      value,
      color: readFieldColor('definitions', key),
    }));
  }

  metaLabel(value: string): string {
    return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(this.i18n.currentLanguage));
  }

  restoreMissing(key: string): void {
    const next = restoreMissingToken(this.language(), key);
    this.blacklist.set(next);
    if (!next.length) this.hiddenOpen.set(false);
  }

  activityCardLabel(key: ActivityKey, day: number): string {
    const name = this.activityName(key);
    const when = this.dayBadge() || this.i18n.translate('stats.thisDay');
    const gained =
      day === 1
        ? this.i18n.translate('stats.oneName', { name })
        : this.i18n.translate('stats.countName', { count: this.formatCount(day), name });
    return this.i18n.translate('stats.gainedWhen', { gained, when });
  }

  streakLabel(): string {
    const amount = this.formatCount(this.streak());
    return this.i18n.translate(this.streak() === 1 ? 'stats.streakOne' : 'stats.streakMany', {
      count: amount,
    });
  }

  private activityName(key: ActivityKey): string {
    if (key === 'added') return this.i18n.translate('stats.addedLower');
    if (key === 'seen') return this.i18n.translate('stats.seenLower');
    return this.i18n.translate('stats.goalExercises');
  }

  private saveGoal(kind: GoalKind, value: number | null): void {
    const next: DailyGoals = { ...this.goals(), [kind]: value };
    this.goals.set(next);
    writeDailyGoals(this.language(), next);
  }
}

function sameElementSort(current: ElementSort | null, sort: ElementSort): boolean {
  return current?.kind === sort.kind;
}

function metricCount(element: ElementDayStats, sort: ElementSort): number {
  if (sort.kind === 'exercises') return element.exercises;
  if (sort.kind === 'seen') return element.seen;
  return element.differential ?? Number.NEGATIVE_INFINITY;
}

function compareElements(
  left: ElementDayStats,
  right: ElementDayStats,
  sort: ElementSort | null,
  language: string,
): number {
  const diff = sort
    ? metricCount(right, sort) - metricCount(left, sort)
    : compareElementsDefault(left, right);
  if (diff) return diff;
  return displayTitle(left.title, language).localeCompare(
    displayTitle(right.title, language),
    language,
  );
}

function compareElementsDefault(left: ElementDayStats, right: ElementDayStats): number {
  if (right.exercises !== left.exercises) return right.exercises - left.exercises;
  return activityTotal(right) - activityTotal(left);
}

function activityTotal(element: ElementDayStats): number {
  return element.added + element.revealed + element.seen;
}

function formatDay(day: string, i18n: LanguageService): string {
  const value = calendarDay(day);
  if (!value) return day;
  const today = new Date();
  const diff = dayDistance(value, today);
  const locale = i18n.currentLanguage;
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(value);
  if (diff === 0) return i18n.translate('stats.todayDate', { date: short });
  if (diff === 1) return i18n.translate('stats.yesterdayDate', { date: short });
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  if (value.getFullYear() !== today.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(locale, options).format(value);
}

function formatDayBadge(day: string, i18n: LanguageService): string {
  const value = calendarDay(day);
  if (!value) return i18n.translate('stats.thatDay');
  const diff = dayDistance(value, new Date());
  if (diff === 0) return i18n.translate('stats.today');
  if (diff === 1) return i18n.translate('stats.yesterday');
  return i18n.translate('stats.thatDay');
}

function calendarDay(day: string): Date | null {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return null;
  return new Date(year, month - 1, date);
}

function dayDistance(value: Date, today: Date): number {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((todayStart - value.getTime()) / 86_400_000);
}

function isToday(day: string): boolean {
  const value = calendarDay(day);
  return !!value && dayDistance(value, new Date()) === 0;
}

function streakLength(days: readonly string[]): number {
  const active = new Set(days);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let count = 0;
  while (active.has(dayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today stays first, with zero counts, when nothing happened yet. */
function daysWithToday(days: readonly DayStats[]): readonly DayStats[] {
  const today = dayKey(new Date());
  if (days.some((day) => day.day === today)) return days;
  return [
    {
      day: today,
      added: 0,
      revealed: 0,
      exercises: 0,
      seen: 0,
      differential: 0,
      elements: [],
    },
    ...days,
  ];
}
