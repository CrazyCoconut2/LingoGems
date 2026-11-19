import { NgTemplateOutlet } from '@angular/common';
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
import { displayTitle, languageDisplayName } from 'collection';
import { supportLanguageFor } from '../languages/translation-language';
import {
  emptyDailyGoals,
  readDailyGoals,
  readGoalInput,
  writeDailyGoals,
  type DailyGoals,
} from './gem-stats-goals';
import { GemStatsJob } from './gem-stats-job';
import { ignoreMissingToken, readMissingBlacklist, restoreMissingToken } from './gem-stats-missing';
import { GemIcon } from './gem-icon';
import { RevealIcon } from './reveal-icon';
import type { DayStats, ElementDayStats, GemCounts, MissingToken } from './gem-stats.worker';

type GemGame = keyof GemCounts;

const GAMES: readonly { game: GemGame; label: string }[] = [
  { game: 'translation', label: 'Translation' },
  { game: 'example', label: 'Example' },
  { game: 'definition', label: 'Definition' },
];

type ActivityKey = 'opened' | 'reworked' | 'revealed';

const ACTIVITIES: readonly {
  key: ActivityKey;
  label: string;
}[] = [
  { key: 'opened', label: 'Seen' },
  { key: 'reworked', label: 'Reworked' },
  { key: 'revealed', label: 'Revealed' },
];

type ElementSort =
  { kind: 'exercises' } | { kind: 'gem'; game: GemGame } | { kind: 'activity'; key: ActivityKey };

type GoalKind = keyof DailyGoals;

const LOADING_ACTIVITY = [0, 1, 2];
const LOADING_ROWS = [0, 1, 2, 3];

const EMPTY_DAY: DayStats = {
  day: '',
  gems: { translation: 0, example: 0, definition: 0 },
  added: 0,
  opened: 0,
  reworked: 0,
  revealed: 0,
  exercises: 0,
  elements: [],
};

@Component({
  selector: 'app-gem-stats',
  imports: [NgTemplateOutlet, GemIcon, RevealIcon],
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Stats"
      [attr.aria-busy]="pending() ? true : null"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div class="header-bar">
            <div>
              <h2>Stats</h2>
              <p class="language">
                <span>{{ languageName() }}</span>
                @if (error()) {
                  <span class="failed">Could not count stats.</span>
                }
              </p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="icon-btn"
                [class.on]="goalsOpen()"
                aria-label="Daily goals"
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
              <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
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
              aria-label="Older day"
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
              <p class="day">{{ dayLabel() || '—' }}</p>
            }
            <button
              type="button"
              class="icon-btn"
              aria-label="Newer day"
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
              <div class="hero hero-loading">
                <div class="hero-copy">
                  <span class="bone bone-label"></span>
                  <span class="bone bone-hero"></span>
                </div>
              </div>
              <section class="block">
                <div class="block-head">
                  <h3>Gems</h3>
                </div>
                <ul class="gems">
                  @for (row of games(); track row.game) {
                    <li class="loading-card">
                      <span class="bone bone-stone"></span>
                      <span class="bone bone-count"></span>
                      <span class="bone bone-caption"></span>
                    </li>
                  }
                </ul>
              </section>
              <section class="block">
                <div class="block-head">
                  <h3>Activity</h3>
                </div>
                <ul class="activity">
                  @for (item of loadingActivity; track item) {
                    <li class="loading-card">
                      <span class="bone bone-stone"></span>
                      <span class="bone bone-count"></span>
                      <span class="bone bone-caption"></span>
                    </li>
                  }
                </ul>
              </section>
              <section class="block deck">
                <div class="block-head">
                  <h3>Elements</h3>
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
            <div class="lead">
              @if (viewingToday()) {
                <div
                  class="streak-card"
                  [attr.aria-label]="streakLabel()"
                  [attr.title]="streakLabel()"
                >
                  <span class="well" aria-hidden="true">
                    <svg class="flame" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-3 3-4 2z"
                      />
                    </svg>
                  </span>
                  <span class="count">{{ formatCount(streak()) }}</span>
                  <span class="caption">Streak</span>
                </div>
              }
              <div
                class="streak-card added-card"
                [attr.aria-label]="activityCardLabel('Added', shown().added)"
                [attr.title]="activityCardLabel('Added', shown().added)"
              >
                <span class="well" aria-hidden="true">
                  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                </span>
                <span class="count">{{ formatCount(shown().added) }}</span>
                <span class="caption">Added</span>
                @if (goalsOpen() || goals().added !== null) {
                  <div class="card-foot">
                    @if (goalsOpen()) {
                      <span class="card-goal-label">Goal</span>
                      <ng-container
                        *ngTemplateOutlet="goalStepper; context: { kind: 'added', label: 'added' }"
                      />
                    }
                    @if (goals().added; as goal) {
                      <div
                        class="meter"
                        role="progressbar"
                        aria-valuemin="0"
                        [attr.aria-valuenow]="meterNow(shown().added, goal)"
                        [attr.aria-valuemax]="goal"
                        [attr.aria-label]="addedMeterLabel(goal)"
                      >
                        <span class="meter-track">
                          <span
                            class="meter-fill"
                            [style.width.%]="meterPercent(shown().added, goal)"
                          ></span>
                        </span>
                        <span class="meter-label">{{ meterText(shown().added, goal) }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
              <div class="hero" [attr.aria-label]="exerciseLabel(shown().exercises)">
                <div class="hero-stats">
                  <span class="well" aria-hidden="true">
                    <ng-container *ngTemplateOutlet="exerciseIcon" />
                  </span>
                  <span class="count">{{ formatCount(shown().exercises) }}</span>
                  <span class="caption">Exercises</span>
                </div>
                @if (goalsOpen() || goals().exercises !== null) {
                  <div class="card-foot">
                    @if (goalsOpen()) {
                      <span class="card-goal-label">Goal</span>
                      <ng-container
                        *ngTemplateOutlet="
                          goalStepper;
                          context: { kind: 'exercises', label: 'exercises' }
                        "
                      />
                    }
                    @if (goals().exercises; as goal) {
                      <div
                        class="meter"
                        role="progressbar"
                        aria-valuemin="0"
                        [attr.aria-valuenow]="meterNow(shown().exercises, goal)"
                        [attr.aria-valuemax]="goal"
                        [attr.aria-label]="exerciseMeterLabel(goal)"
                      >
                        <span class="meter-track">
                          <span
                            class="meter-fill"
                            [style.width.%]="meterPercent(shown().exercises, goal)"
                          ></span>
                        </span>
                        <span class="meter-label">{{ meterText(shown().exercises, goal) }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
            <section class="block">
              <div class="block-head">
                <h3>Gems</h3>
              </div>
              <ul class="gems">
                @for (row of games(); track row.game) {
                  <li
                    [attr.data-game]="row.game"
                    [attr.aria-label]="
                      gemCardLabel(row.label, gemTotals()[row.game], shown().gems[row.game])
                    "
                    [attr.title]="
                      gemCardLabel(row.label, gemTotals()[row.game], shown().gems[row.game])
                    "
                  >
                    <span class="stone" aria-hidden="true">
                      <app-gem-icon class="stone-icon" [game]="row.game" />
                    </span>
                    <span class="count">{{ formatCount(gemTotals()[row.game]) }}</span>
                    <span class="caption">{{ row.label }}</span>
                    @if (shown().gems[row.game] > 0) {
                      <span class="delta">
                        +{{ formatCount(shown().gems[row.game]) }}
                        @if (dayBadge()) {
                          {{ dayBadge() }}
                        }
                      </span>
                    }
                    @if (goalsOpen() || goals()[row.game] !== null) {
                      <div class="card-foot">
                        @if (goalsOpen()) {
                          <span class="card-goal-label">Goal</span>
                          <ng-container
                            *ngTemplateOutlet="
                              goalStepper;
                              context: { kind: row.game, label: row.label.toLowerCase() }
                            "
                          />
                        }
                        @if (goals()[row.game]; as goal) {
                          <div
                            class="meter"
                            role="progressbar"
                            aria-valuemin="0"
                            [attr.aria-valuenow]="meterNow(shown().gems[row.game], goal)"
                            [attr.aria-valuemax]="goal"
                            [attr.aria-label]="
                              gemMeterLabel(row.label, shown().gems[row.game], goal)
                            "
                          >
                            <span class="meter-track">
                              <span
                                class="meter-fill"
                                [style.width.%]="meterPercent(shown().gems[row.game], goal)"
                              ></span>
                            </span>
                            <span class="meter-label">{{
                              meterText(shown().gems[row.game], goal)
                            }}</span>
                          </div>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
            <section class="block">
              <div class="block-head">
                <h3>Activity</h3>
              </div>
              <ul class="activity">
                @for (row of activities; track row.key) {
                  <li
                    [attr.aria-label]="activityCardLabel(row.label, shown()[row.key])"
                    [attr.title]="activityCardLabel(row.label, shown()[row.key])"
                  >
                    <span class="well" aria-hidden="true">
                      <ng-container
                        *ngTemplateOutlet="activityIcon; context: { $implicit: row.key }"
                      />
                    </span>
                    <span class="count">{{ formatCount(shown()[row.key]) }}</span>
                    <span class="caption">{{ row.label }}</span>
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
                  <span class="fold-title">Elements</span>
                  <span class="fold-count">{{ formatCount(sortedElements().length) }}</span>
                </button>
                <div class="sort-menu">
                  <button
                    type="button"
                    class="icon-btn"
                    [class.on]="sortMenuOpen() || elementSort()"
                    [attr.aria-expanded]="sortMenuOpen()"
                    aria-label="Sort elements"
                    title="Sort"
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
                      aria-label="Sort elements"
                      [style.max-height.px]="sortMenuMax()"
                      (click)="$event.stopPropagation()"
                    >
                      @for (option of elementSortOptions(); track option.id) {
                        <button
                          type="button"
                          class="popover-option"
                          role="option"
                          [class.selected]="isSort(option.sort)"
                          [attr.aria-selected]="isSort(option.sort)"
                          (click)="chooseElementSort(option.sort)"
                        >
                          {{ option.label }}
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
                          <span class="new-sign">New</span>
                        }
                        <div class="row-main">
                          <span class="title" [attr.title]="titleOf(element)">{{
                            titleOf(element)
                          }}</span>
                          @if (hasBits(element) || elementSort()) {
                            <span class="bits">
                              @for (activity of activities; track activity.key) {
                                <span
                                  class="bit"
                                  [class.on]="isSort(activitySort(activity.key))"
                                  [attr.aria-label]="
                                    activityLabel(activity.label, element[activity.key])
                                  "
                                  [attr.title]="
                                    activityLabel(activity.label, element[activity.key])
                                  "
                                >
                                  <ng-container
                                    *ngTemplateOutlet="
                                      activityIcon;
                                      context: { $implicit: activity.key }
                                    "
                                  />
                                  <span>{{ element[activity.key] }}</span>
                                </span>
                              }
                              @if (showsMetric(element.exercises, exerciseSort)) {
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
                              @for (game of games(); track game.game) {
                                @if (showsMetric(element.gems[game.game], gemSort(game.game))) {
                                  <span
                                    class="bit"
                                    [class.on]="isSort(gemSort(game.game))"
                                    [attr.data-game]="game.game"
                                    [attr.aria-label]="
                                      gemsLabel(game.label, element.gems[game.game])
                                    "
                                    [attr.title]="gemsLabel(game.label, element.gems[game.game])"
                                  >
                                    <app-gem-icon class="stone-icon" [game]="game.game" />
                                    <span>{{ element.gems[game.game] }}</span>
                                  </span>
                                }
                              }
                            </span>
                          }
                        </div>
                      </button>
                    </li>
                  }
                </ul>
                @if (!sortedElements().length) {
                  <p class="hint elements-empty">Nothing recorded yet.</p>
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
                    <span class="fold-title">Missing</span>
                    <span class="fold-count">{{ formatCount(visibleMissing().length) }}</span>
                  </button>
                </div>
                @if (missingOpen()) {
                  @if (askError()) {
                    <p class="hint missing-error">{{ askError() }}</p>
                  }
                  <ul class="elements">
                    @for (token of visibleMissing(); track token.key) {
                      <li>
                        <div class="row missing-row">
                          <div class="row-main">
                            <span class="title" [attr.title]="token.title">{{ token.title }}</span>
                            <span class="bits">
                              <span
                                class="bit"
                                [attr.aria-label]="seenLabel(token.seen)"
                                [attr.title]="seenLabel(token.seen)"
                              >
                                <ng-container
                                  *ngTemplateOutlet="activityIcon; context: { $implicit: 'opened' }"
                                />
                                <span>{{ formatCount(token.seen) }}</span>
                              </span>
                            </span>
                          </div>
                          <div class="missing-actions">
                            <button
                              type="button"
                              class="icon-btn"
                              aria-label="Ask AI"
                              title="Ask AI"
                              [disabled]="asking()"
                              [attr.aria-busy]="asking() ? true : null"
                              (click)="askMissing.emit(token.title)"
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
                              aria-label="Remove"
                              title="Remove"
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
                          <span class="fold-title">Hidden</span>
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
                                      [attr.aria-label]="seenLabel(token.seen)"
                                      [attr.title]="seenLabel(token.seen)"
                                    >
                                      <ng-container
                                        *ngTemplateOutlet="
                                          activityIcon;
                                          context: { $implicit: 'opened' }
                                        "
                                      />
                                      <span>{{ formatCount(token.seen) }}</span>
                                    </span>
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  class="restore"
                                  [attr.aria-label]="'Restore ' + token.title"
                                  (click)="restoreMissing(token.key)"
                                >
                                  Restore
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
          [attr.aria-label]="'Decrease ' + label + ' goal'"
          [disabled]="!goalSet(kind)"
          (click)="stepGoal(kind, -1)"
        >
          −
        </button>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          [attr.aria-label]="label + ' daily goal'"
          placeholder="–"
          [value]="goalValue(kind)"
          (change)="commitGoal(kind, $event)"
        />
        <button
          type="button"
          [attr.aria-label]="'Increase ' + label + ' goal'"
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
        @case ('opened') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
        @case ('revealed') {
          <app-reveal-icon />
        }
        @case ('reworked') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
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

    .lead {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: 0.45rem;
      margin: 0.7rem 1rem 0;
    }

    .hero {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0.65rem;
      min-width: 0;
      margin: 0.7rem 1rem 0;
      padding: 0.8rem 0.55rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
      color: var(--text);
    }

    .lead .hero {
      margin: 0;
    }

    .streak-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 0.12rem;
      min-width: 0;
      padding: 0.8rem 0.55rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: var(--surface-2);
      color: var(--text-muted);
    }

    .streak-card .well {
      display: grid;
      place-items: center;
      width: 2.35rem;
      height: 2.35rem;
      margin-bottom: 0.28rem;
      border-radius: 0.7rem;
      background: rgba(255, 122, 26, 0.16);
      color: #ff7a1a;
      box-shadow: inset 0 0 0 1px rgba(255, 122, 26, 0.45);
    }

    .streak-card .well .mark,
    .streak-card .flame {
      width: 1.45rem;
      height: 1.45rem;
    }

    .streak-card .count {
      color: var(--text);
      font-size: 1.55rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .streak-card .caption {
      max-width: 100%;
      color: var(--text-muted);
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
    }

    .added-card {
      align-items: stretch;
    }

    .added-card .well,
    .added-card .count,
    .added-card .caption {
      align-self: center;
    }

    .added-card .well {
      background: rgba(8, 10, 18, 0.45);
      color: var(--text-muted);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    }

    .activity app-reveal-icon {
      width: 2.15rem;
      height: 1.12rem;
    }

    .bit app-reveal-icon {
      width: 1.76rem;
      height: 0.92rem;
    }

    .hero-copy,
    .hero-stats {
      min-width: 0;
    }

    .hero-stats {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.12rem;
    }

    .hero-stats .well {
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

    .hero-stats .mark {
      width: 1.45rem;
      height: 1.45rem;
    }

    .hero-stats .count {
      color: var(--text);
      font-size: 1.55rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .hero-stats .caption {
      color: var(--text-muted);
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1.2;
      text-transform: uppercase;
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

    .eyebrow,
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

    .block-note {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 650;
      line-height: 1.2;
      text-align: right;
    }

    .gems,
    .activity,
    .elements {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .gems,
    .activity {
      display: grid;
      gap: 0.45rem;
    }

    .gems {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .activity {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .gems li,
    .activity li {
      min-width: 0;
    }

    .gems li {
      --goal: var(--exercise-gem);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.85rem 0.55rem 0.7rem;
      border: 1px solid color-mix(in srgb, var(--exercise-gem) 32%, transparent);
      border-radius: 1rem;
      background: color-mix(in srgb, var(--exercise-gem) 13%, rgba(8, 10, 18, 0.55));
    }

    .gems li[data-game='translation'],
    .bit[data-game='translation'] {
      --exercise-gem: var(--gem-translation);
    }

    .gems li[data-game='example'],
    .bit[data-game='example'] {
      --exercise-gem: var(--gem-example);
    }

    .gems li[data-game='definition'],
    .bit[data-game='definition'] {
      --exercise-gem: var(--gem-definition);
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

    .gems .meter {
      align-self: stretch;
      width: 100%;
    }

    .gems .stone,
    .activity .well {
      display: grid;
      place-items: center;
      margin-bottom: 0.28rem;
      border-radius: 0.7rem;
    }

    .gems .stone {
      width: 2.35rem;
      height: 2.35rem;
      background: color-mix(in srgb, var(--exercise-gem) 16%, rgba(6, 8, 16, 0.82));
      color: var(--exercise-gem);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--exercise-gem) 38%, transparent);
    }

    .activity .well {
      width: 2.35rem;
      height: 2.35rem;
      background: rgba(8, 10, 18, 0.45);
      color: var(--text-muted);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    }

    .activity .well .mark {
      width: 1.45rem;
      height: 1.45rem;
    }

    .stone-icon {
      display: block;
      width: 1.45rem;
      height: 1.45rem;
      flex: none;
    }

    .bit .stone-icon {
      width: 0.82rem;
      height: 0.82rem;
    }

    .gems .count {
      color: var(--text);
      font-size: 1.65rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .gems .caption,
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

    .gems .delta {
      max-width: 100%;
      margin-top: 0.35rem;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.32);
      color: var(--exercise-gem);
      font-size: 0.68rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .gems .delta.quiet {
      color: var(--text-muted);
      font-weight: 650;
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
      line-height: 1;
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

    .bit[data-game] {
      color: var(--exercise-gem);
    }

    .bit.on {
      font-weight: 750;
    }

    .bit.on:not([data-game]) {
      color: var(--text);
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

    .bit .mark,
    .bit .stone-icon {
      display: block;
      width: 0.92rem;
      height: 0.92rem;
      flex: none;
      margin: 0;
    }

    .hero-loading {
      border-color: rgba(255, 255, 255, 0.08);
      background: var(--surface-2);
      color: var(--text-muted);
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

    .bone-label {
      width: 4.4rem;
      height: 0.55rem;
    }

    .bone-hero {
      width: 5.5rem;
      height: 2.4rem;
      margin-top: 0.45rem;
      border-radius: 0.7rem;
    }

    .gems li.loading-card,
    .activity li.loading-card {
      border-color: var(--border);
      background: rgba(255, 255, 255, 0.03);
    }

    .bone-stone {
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
export class GemStatsModal {
  readonly language = input.required<string>();
  readonly asking = input(false);
  readonly askError = input('');
  readonly closed = output<void>();
  readonly opened = output<string>();
  readonly askMissing = output<string>();
  readonly games = computed(() =>
    supportLanguageFor(this.language()) ? GAMES : GAMES.filter((row) => row.game !== 'translation'),
  );
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
  readonly elementSortOptions = computed(() => {
    const options: { id: string; sort: ElementSort; label: string }[] = [
      { id: 'exercises', sort: this.exerciseSort, label: 'Most exercises' },
    ];
    for (const row of this.games()) {
      options.push({
        id: row.game,
        sort: { kind: 'gem', game: row.game },
        label: `Most ${row.label.toLowerCase()} gems`,
      });
    }
    for (const row of this.activities) {
      options.push({
        id: row.key,
        sort: { kind: 'activity', key: row.key },
        label: `Most ${row.label.toLowerCase()}`,
      });
    }
    return options;
  });

  private readonly job = inject(GemStatsJob);

  readonly stats = computed(() => this.job.view(this.language()));
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
  readonly gemTotals = computed(() => {
    const totals: GemCounts = { translation: 0, example: 0, definition: 0 };
    for (const day of this.snapshot()?.days ?? []) {
      totals.translation += day.gems.translation;
      totals.example += day.gems.example;
      totals.definition += day.gems.definition;
    }
    return totals;
  });
  readonly canGoOlder = computed(() => this.dayIndex() < this.days().length - 1);
  readonly canGoNewer = computed(() => this.dayIndex() > 0);
  readonly dayLabel = computed(() => {
    const current = this.day();
    return current ? formatDay(current.day) : '';
  });
  readonly dayBadge = computed(() => {
    const current = this.day();
    return current ? formatDayBadge(current.day) : '';
  });
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

  gemSort(game: GemGame): ElementSort {
    return { kind: 'gem', game };
  }

  activitySort(key: ActivityKey): ElementSort {
    return { kind: 'activity', key };
  }

  isSort(sort: ElementSort): boolean {
    return sameElementSort(this.elementSort(), sort);
  }

  toggleSort(sort: ElementSort): void {
    this.elementSort.update((current) => (sameElementSort(current, sort) ? null : sort));
  }

  showsMetric(count: number, sort: ElementSort): boolean {
    return count > 0 || this.isSort(sort);
  }

  toggleGoals(): void {
    this.goalsOpen.update((open) => !open);
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

  exerciseMeterLabel(goal: number): string {
    return `Exercises ${this.meterText(this.shown().exercises, goal)}`;
  }

  addedMeterLabel(goal: number): string {
    return `Added ${this.meterText(this.shown().added, goal)}`;
  }

  gemMeterLabel(label: string, gain: number, goal: number): string {
    return `${label} gems gained ${this.meterText(gain, goal)}`;
  }

  titleOf(element: ElementDayStats): string {
    return displayTitle(element.title, this.language());
  }

  hasBits(element: ElementDayStats): boolean {
    const gems = this.games().reduce((sum, row) => sum + element.gems[row.game], 0);
    const activity = element.added + element.opened + element.reworked + element.revealed;
    return gems + element.exercises + activity > 0;
  }

  languageName(): string {
    return languageDisplayName(this.language());
  }

  gemsLabel(game: string, count: number): string {
    const amount = count === 1 ? '1 gem' : `${count} gems`;
    return `${amount}, ${game.toLowerCase()}`;
  }

  gemCardLabel(game: string, total: number, day: number): string {
    const name = game.toLowerCase();
    const overall = total === 1 ? '1 gem' : `${total} gems`;
    const gained = day === 1 ? '1 gem' : `${day} gems`;
    const when = this.dayBadge() || 'this day';
    return `${overall} ${name} in total, ${gained} ${when}`;
  }

  formatCount(count: number): string {
    return new Intl.NumberFormat(undefined).format(count);
  }

  exerciseLabel(count: number): string {
    const amount = this.formatCount(count);
    return count === 1 ? `${amount} exercise` : `${amount} exercises`;
  }

  activityLabel(label: string, count: number): string {
    return `${count} ${label.toLowerCase()}`;
  }

  seenLabel(count: number): string {
    const amount = this.formatCount(count);
    return count === 1 ? `Seen ${amount} time` : `Seen ${amount} times`;
  }

  hideMissing(token: MissingToken): void {
    if (this.asking()) return;
    this.blacklist.set(ignoreMissingToken(this.language(), token.key));
  }

  restoreMissing(key: string): void {
    const next = restoreMissingToken(this.language(), key);
    this.blacklist.set(next);
    if (!next.length) this.hiddenOpen.set(false);
  }

  activityCardLabel(label: string, day: number): string {
    const name = label.toLowerCase();
    const when = this.dayBadge() || 'this day';
    const gained = day === 1 ? `1 ${name}` : `${day} ${name}`;
    return `${gained} ${when}`;
  }

  streakLabel(): string {
    const amount = this.formatCount(this.streak());
    return `${amount} day streak`;
  }

  private saveGoal(kind: GoalKind, value: number | null): void {
    const next: DailyGoals = { ...this.goals(), [kind]: value };
    this.goals.set(next);
    writeDailyGoals(this.language(), next);
  }
}

function sameElementSort(current: ElementSort | null, sort: ElementSort): boolean {
  if (!current || current.kind !== sort.kind) return false;
  switch (sort.kind) {
    case 'exercises':
      return true;
    case 'gem':
      return current.kind === 'gem' && current.game === sort.game;
    case 'activity':
      return current.kind === 'activity' && current.key === sort.key;
  }
}

function metricCount(element: ElementDayStats, sort: ElementSort): number {
  if (sort.kind === 'exercises') return element.exercises;
  if (sort.kind === 'gem') return element.gems[sort.game];
  return element[sort.key];
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
  const gems = gemTotal(right) - gemTotal(left);
  if (gems) return gems;
  if (right.exercises !== left.exercises) return right.exercises - left.exercises;
  return activityTotal(right) - activityTotal(left);
}

function gemTotal(element: ElementDayStats): number {
  const gems = element.gems;
  return gems.translation + gems.example + gems.definition;
}

function activityTotal(element: ElementDayStats): number {
  return element.opened + element.reworked + element.revealed;
}

function formatDay(day: string): string {
  const value = calendarDay(day);
  if (!value) return day;
  const today = new Date();
  const diff = dayDistance(value, today);
  const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    value,
  );
  if (diff === 0) return `Today, ${short}`;
  if (diff === 1) return `Yesterday, ${short}`;
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  if (value.getFullYear() !== today.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(undefined, options).format(value);
}

function formatDayBadge(day: string): string {
  const value = calendarDay(day);
  if (!value) return 'that day';
  const diff = dayDistance(value, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return 'that day';
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
      gems: { translation: 0, example: 0, definition: 0 },
      added: 0,
      opened: 0,
      reworked: 0,
      revealed: 0,
      exercises: 0,
      elements: [],
    },
    ...days,
  ];
}
