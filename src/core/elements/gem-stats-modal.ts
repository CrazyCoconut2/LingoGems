import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { displayTitle, languageDisplayName } from 'collection';
import {
  emptyDailyGoals,
  readDailyGoals,
  readGoalInput,
  writeDailyGoals,
  type DailyGoals,
} from './gem-stats-goals';
import { GemStatsJob } from './gem-stats-job';
import { comfortColor } from './comfort-palette';
import { GemIcon } from './gem-icon';
import type { DayStats, ElementDayStats, GemCounts } from './gem-stats.worker';

type GemGame = keyof GemCounts;

const GAMES: readonly { game: GemGame; label: string }[] = [
  { game: 'translation', label: 'Translation' },
  { game: 'example', label: 'Example' },
  { game: 'definition', label: 'Definition' },
];

const ACTIVITIES: readonly { key: 'opened' | 'reworked' | 'revealed'; label: string }[] = [
  { key: 'opened', label: 'Opened' },
  { key: 'reworked', label: 'Reworked' },
  { key: 'revealed', label: 'Revealed' },
];

type GoalKind = keyof DailyGoals;

const LOADING_CARDS = [0, 1, 2];
const LOADING_ROWS = [0, 1, 2, 3];

const EMPTY_DAY: DayStats = {
  day: '',
  gems: { translation: 0, example: 0, definition: 0 },
  opened: 0,
  reworked: 0,
  revealed: 0,
  comfort: 0,
  elements: [],
};

@Component({
  selector: 'app-gem-stats',
  imports: [NgTemplateOutlet, GemIcon],
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
                <div class="hero-top">
                  <div class="hero-copy">
                    <span class="bone bone-label"></span>
                    <span class="bone bone-hero"></span>
                  </div>
                  <span class="bone bone-badge"></span>
                </div>
              </div>
              <section class="block">
                <div class="block-head">
                  <h3>Gems</h3>
                </div>
                <ul class="gems">
                  @for (item of loadingCards; track item) {
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
                  @for (item of loadingCards; track item) {
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
            <div
              class="hero"
              [style.--comfort]="comfortTone(shown().comfort)"
              [attr.aria-label]="comfortLabel(shown().comfort)"
              [attr.title]="comfortLabel(shown().comfort)"
            >
              <div class="hero-top">
                <div class="hero-copy">
                  <p class="eyebrow">Comfort</p>
                  <p class="hero-value">{{ formatSigned(shown().comfort) }}</p>
                </div>
                @if (dayBadge()) {
                  <span class="hero-badge">{{ dayBadge() }}</span>
                }
              </div>
              @if (goalsOpen()) {
                <div class="goal-edit">
                  <span class="goal-edit-label">Daily goal</span>
                  <ng-container
                    *ngTemplateOutlet="goalStepper; context: { kind: 'comfort', label: 'comfort' }"
                  />
                </div>
              }
              @if (goals().comfort; as goal) {
                <div
                  class="meter"
                  role="progressbar"
                  aria-valuemin="0"
                  [attr.aria-valuenow]="meterNow(comfortGain(), goal)"
                  [attr.aria-valuemax]="goal"
                  [attr.aria-label]="comfortMeterLabel(goal)"
                >
                  <span class="meter-track">
                    <span
                      class="meter-fill"
                      [style.width.%]="meterPercent(comfortGain(), goal)"
                    ></span>
                  </span>
                  <span class="meter-label">{{ meterText(comfortGain(), goal) }}</span>
                </div>
              }
            </div>
            <section class="block">
              <div class="block-head">
                <h3>Gems</h3>
              </div>
              <ul class="gems">
                @for (row of games; track row.game) {
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
              <div class="block-head">
                <h3>Elements</h3>
              </div>
              <ul class="elements">
                @if (day(); as current) {
                  @for (element of current.elements; track element.id) {
                    <li class="row">
                      @if (element.comfort !== 0) {
                        <span
                          class="badge"
                          [attr.data-sign]="element.comfort > 0 ? 'up' : 'down'"
                          [attr.aria-label]="comfortLabel(element.comfort)"
                          [attr.title]="comfortLabel(element.comfort)"
                        >
                          {{ formatSigned(element.comfort) }}
                        </span>
                      }
                      <div class="row-main">
                        <span class="title" [attr.title]="titleOf(element)">{{
                          titleOf(element)
                        }}</span>
                        @if (hasBits(element)) {
                          <span class="bits">
                            @for (row of games; track row.game) {
                              @if (element.gems[row.game] > 0) {
                                <span
                                  class="bit"
                                  [attr.data-game]="row.game"
                                  [attr.aria-label]="gemsLabel(row.label, element.gems[row.game])"
                                  [attr.title]="gemsLabel(row.label, element.gems[row.game])"
                                >
                                  <app-gem-icon class="stone-icon" [game]="row.game" />
                                  <span>{{ element.gems[row.game] }}</span>
                                </span>
                              }
                            }
                            @for (row of activities; track row.key) {
                              @if (element[row.key] > 0) {
                                <span
                                  class="bit"
                                  [attr.aria-label]="activityLabel(row.label, element[row.key])"
                                  [attr.title]="activityLabel(row.label, element[row.key])"
                                >
                                  <ng-container
                                    *ngTemplateOutlet="
                                      activityIcon;
                                      context: { $implicit: row.key }
                                    "
                                  />
                                  <span>{{ element[row.key] }}</span>
                                </span>
                              }
                            }
                          </span>
                        }
                      </div>
                    </li>
                  }
                } @else {
                  <li class="placeholder">
                    <p class="hint">Nothing recorded yet.</p>
                  </li>
                }
              </ul>
            </section>
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
    <ng-template #activityIcon let-key>
      @switch (key) {
        @case ('opened') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
            />
          </svg>
        }
        @case ('reworked') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        }
        @case ('revealed') {
          <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
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
      backdrop-filter: blur(6px);
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
      background:
        radial-gradient(120% 80% at 0% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
        var(--surface);
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
      font-size: 1.35rem;
      font-weight: 750;
      letter-spacing: -0.03em;
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
      width: 2.15rem;
      height: 2.15rem;
      flex-shrink: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.1);
      color: var(--text-muted);
      cursor: pointer;
    }

    .icon-btn:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.18);
      color: var(--text);
    }

    .icon-btn.on {
      background: rgba(var(--accent-rgb), 0.18);
      color: var(--accent-text);
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

    .hero {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
      flex-shrink: 0;
      min-width: 0;
      margin: 0.7rem 1rem 0;
      padding: 1rem 1.05rem 0.95rem;
      border: 1px solid color-mix(in srgb, var(--comfort) 36%, transparent);
      border-radius: 1.05rem;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--comfort) 18%, transparent),
        color-mix(in srgb, var(--comfort) 7%, rgba(8, 10, 18, 0.35))
      );
      color: var(--comfort);
    }

    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      min-width: 0;
    }

    .hero-copy {
      min-width: 0;
    }

    .goal-edit {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .goal-edit-label {
      color: var(--text-muted);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .hero .count-stepper button {
      background: rgba(0, 0, 0, 0.28);
      color: inherit;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 42%, transparent);
    }

    .hero .count-stepper button:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.42);
    }

    .hero .count-stepper input {
      width: 2.2rem;
      color: inherit;
    }

    .hero .count-stepper input::placeholder {
      color: color-mix(in srgb, currentColor 48%, transparent);
    }

    .meter {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
    }

    .meter-track {
      flex: 1;
      height: 0.45rem;
      min-width: 0;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.32);
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
      font-size: 0.72rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }

    .hero-badge {
      flex-shrink: 0;
      margin-top: 0.1rem;
      padding: 0.28rem 0.62rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.32);
      font-size: 0.75rem;
      font-weight: 750;
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

    .hero .eyebrow {
      color: var(--text-muted);
    }

    .hero-value {
      margin-top: 0.28rem;
      font-size: 2.7rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.045em;
      line-height: 0.95;
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
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
    }

    .gems li,
    .activity li {
      min-width: 0;
    }

    .gems li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.85rem 0.55rem 0.7rem;
      border: 1px solid color-mix(in srgb, var(--exercise-gem) 32%, transparent);
      border-radius: 1.05rem;
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
      background: color-mix(in srgb, var(--exercise-gem) 18%, rgba(6, 8, 16, 0.72));
      color: var(--exercise-gem);
      font-size: 0.85rem;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--exercise-gem) 42%, transparent);
    }

    .card-foot .count-stepper button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--exercise-gem) 30%, rgba(6, 8, 16, 0.72));
    }

    .card-foot .count-stepper input {
      width: 1.7rem;
      color: var(--exercise-gem);
      font-size: 0.78rem;
    }

    .card-foot .count-stepper input::placeholder {
      color: color-mix(in srgb, var(--exercise-gem) 50%, transparent);
    }

    .gems .meter {
      align-self: stretch;
      width: 100%;
      gap: 0.35rem;
      color: var(--exercise-gem);
    }

    .gems .meter-track {
      height: 0.42rem;
      background: rgba(0, 0, 0, 0.4);
    }

    .gems .meter-fill {
      background: var(--exercise-gem);
    }

    .gems .meter-label {
      color: var(--exercise-gem);
      font-size: 0.62rem;
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
      width: 2.15rem;
      height: 2.15rem;
      background: rgba(8, 10, 18, 0.45);
      color: var(--text-muted);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
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
      border: 1px solid var(--border);
      border-radius: 1.05rem;
      background: rgba(255, 255, 255, 0.035);
      color: var(--text-muted);
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
      flex: 1 0 auto;
      flex-direction: column;
      padding-bottom: 1rem;
    }

    .elements {
      display: flex;
      flex-direction: column;
      align-content: flex-start;
      gap: 0.4rem;
      flex: 1 0 auto;
      margin: 0;
      padding: 0 0 0.35rem;
    }

    .placeholder {
      display: flex;
      flex: 1 0 auto;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      min-height: 6rem;
      padding: 0;
      border: 0;
      background: none;
    }

    .placeholder .hint {
      max-width: 16rem;
      text-align: center;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      max-width: 100%;
      padding: 0.7rem 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 0.95rem;
      background: rgba(255, 255, 255, 0.03);
    }

    .badge {
      display: grid;
      place-items: center;
      min-width: 2.35rem;
      height: 2.15rem;
      flex: none;
      padding: 0 0.4rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .badge[data-sign='up'] {
      border: 1px solid color-mix(in srgb, #e6b325 42%, transparent);
      background: color-mix(in srgb, #e6b325 18%, transparent);
      color: #f0c14a;
    }

    .badge[data-sign='down'] {
      border: 1px solid color-mix(in srgb, var(--danger) 42%, transparent);
      background: color-mix(in srgb, var(--danger) 16%, transparent);
      color: var(--danger);
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
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      font-size: 0.92rem;
      font-weight: 680;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bits {
      display: flex;
      flex: none;
      flex-flow: row nowrap;
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

    .bit .mark,
    .bit .stone-icon {
      display: block;
      width: 0.92rem;
      height: 0.92rem;
      flex: none;
      margin: 0;
    }

    .hero-loading {
      --comfort: var(--text-muted);
      border-color: var(--border);
      background: color-mix(in srgb, var(--text) 4%, transparent);
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

    .bone-badge {
      width: 4.4rem;
      height: 1.4rem;
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
  readonly closed = output<void>();
  readonly games = GAMES;
  readonly activities = ACTIVITIES;
  readonly loadingCards = LOADING_CARDS;
  readonly loadingRows = LOADING_ROWS;
  readonly goalsOpen = signal(false);
  readonly goals = signal<DailyGoals>(emptyDailyGoals());
  readonly dayIndex = signal(0);

  private readonly job = inject(GemStatsJob);

  readonly stats = computed(() => this.job.view(this.language()));
  readonly pending = computed(() => {
    const phase = this.stats().phase;
    return phase === 'pending' || (phase === 'empty' && this.language().trim().length > 0);
  });
  readonly ready = computed(() => this.stats().phase === 'ready');
  readonly error = computed(() => this.stats().phase === 'error');
  readonly snapshot = computed(() => this.stats().snapshot);
  readonly day = computed(() => this.snapshot()?.days[this.dayIndex()] ?? null);
  readonly shown = computed(() => this.day() ?? EMPTY_DAY);
  readonly comfortGain = computed(() => Math.max(this.shown().comfort, 0));
  readonly gemTotals = computed(() => {
    const totals: GemCounts = { translation: 0, example: 0, definition: 0 };
    for (const day of this.snapshot()?.days ?? []) {
      totals.translation += day.gems.translation;
      totals.example += day.gems.example;
      totals.definition += day.gems.definition;
    }
    return totals;
  });
  readonly canGoOlder = computed(() => {
    const total = this.snapshot()?.days.length ?? 0;
    return this.dayIndex() < total - 1;
  });
  readonly canGoNewer = computed(() => this.dayIndex() > 0);
  readonly dayLabel = computed(() => {
    const current = this.day();
    return current ? formatDay(current.day) : '';
  });
  readonly dayBadge = computed(() => {
    const current = this.day();
    return current ? formatDayBadge(current.day) : '';
  });

  constructor() {
    effect(() => {
      const language = this.language();
      untracked(() => {
        this.dayIndex.set(0);
        this.goalsOpen.set(false);
        this.goals.set(readDailyGoals(language));
        this.job.ensure(language);
      });
    });
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  older(): void {
    if (!this.canGoOlder()) return;
    this.dayIndex.update((index) => index + 1);
  }

  newer(): void {
    if (!this.canGoNewer()) return;
    this.dayIndex.update((index) => index - 1);
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

  comfortMeterLabel(goal: number): string {
    return `Comfort increase ${this.meterText(this.comfortGain(), goal)}`;
  }

  gemMeterLabel(label: string, gain: number, goal: number): string {
    return `${label} gems gained ${this.meterText(gain, goal)}`;
  }

  titleOf(element: ElementDayStats): string {
    return displayTitle(element.title, this.language());
  }

  hasBits(element: ElementDayStats): boolean {
    return (
      element.gems.translation +
        element.gems.example +
        element.gems.definition +
        element.opened +
        element.reworked +
        element.revealed >
      0
    );
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

  formatSigned(count: number): string {
    const amount = this.formatCount(Math.abs(count));
    if (count > 0) return `+${amount}`;
    if (count < 0) return `−${amount}`;
    return amount;
  }

  comfortTone(delta: number): string {
    if (delta > 0) return comfortColor(10);
    if (delta < 0) return comfortColor(1);
    return 'var(--text-muted)';
  }

  comfortLabel(delta: number): string {
    if (delta > 0) return `Comfort up ${this.formatCount(delta)}`;
    if (delta < 0) return `Comfort down ${this.formatCount(Math.abs(delta))}`;
    return 'Comfort unchanged';
  }

  activityLabel(label: string, count: number): string {
    return `${count} ${label.toLowerCase()}`;
  }

  activityCardLabel(label: string, day: number): string {
    const name = label.toLowerCase();
    const when = this.dayBadge() || 'this day';
    const gained = day === 1 ? `1 ${name}` : `${day} ${name}`;
    return `${gained} ${when}`;
  }

  private saveGoal(kind: GoalKind, value: number | null): void {
    const next: DailyGoals = { ...this.goals(), [kind]: value };
    this.goals.set(next);
    writeDailyGoals(this.language(), next);
  }
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
