import {
  Component,
  NgZone,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { displayTitle } from 'collection';
import { readStatsSnapshot, writeStatsSnapshot, type StatsSnapshot } from './gem-stats-cache';
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

type StatsMessage = { ok: true; days: DayStats[] } | { ok: false };

@Component({
  selector: 'app-gem-stats',
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Stats"
      [attr.aria-busy]="computing() ? true : null"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div>
            <h2>Stats</h2>
            <p>{{ computedLabel() || 'One day at a time.' }}</p>
          </div>
          <div class="actions">
            @if (snapshot()) {
              <button
                type="button"
                class="icon-btn"
                [class.spin]="computing()"
                aria-label="Recompute stats"
                [disabled]="computing() || !language().trim()"
                [attr.aria-busy]="computing() ? true : null"
                (click)="compute()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </svg>
              </button>
            }
            <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </header>
        @if (snapshot()) {
          <div class="body">
            @if (error()) {
              <p class="banner">Could not count stats.</p>
            }
            @if (day(); as current) {
              <div class="day-nav">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Older day"
                  [disabled]="!canGoOlder()"
                  (click)="older()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <p class="day">{{ dayLabel() }}</p>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Newer day"
                  [disabled]="!canGoNewer()"
                  (click)="newer()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
              <ul class="gems">
                @for (row of games; track row.game) {
                  <li
                    [attr.data-game]="row.game"
                    [attr.aria-label]="gemsLabel(row.label, current.gems[row.game])"
                  >
                    <span class="gem" aria-hidden="true"></span>
                    <span class="count">{{ current.gems[row.game] }}</span>
                    <span class="caption">{{ row.label }}</span>
                  </li>
                }
              </ul>
              <ul class="activity">
                @for (row of activities; track row.key) {
                  <li [attr.aria-label]="row.label + ' ' + current[row.key]">
                    <span class="count">{{ current[row.key] }}</span>
                    <span class="caption">{{ row.label }}</span>
                  </li>
                }
              </ul>
              <ul class="elements">
                @for (element of current.elements; track element.id) {
                  <li class="pill">
                    <span class="title">{{ titleOf(element) }}</span>
                    <span class="bits">
                      @for (row of games; track row.game) {
                        @if (element.gems[row.game] > 0) {
                          <span
                            class="bit"
                            [attr.data-game]="row.game"
                            [attr.aria-label]="gemsLabel(row.label, element.gems[row.game])"
                          >
                            <span class="gem" aria-hidden="true"></span>
                            <span>{{ element.gems[row.game] }}</span>
                          </span>
                        }
                      }
                      @for (row of activities; track row.key) {
                        @if (element[row.key] > 0) {
                          <span class="bit">{{ row.label }} {{ element[row.key] }}</span>
                        }
                      }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="hint">Nothing recorded yet.</p>
            }
          </div>
        } @else {
          <div class="empty">
            <p class="hint">
              {{
                error() ? 'Could not count stats.' : "Compute the day's stats when you want them."
              }}
            </p>
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="computing() || !language().trim()"
              (click)="compute()"
            >
              {{ computing() ? 'Computing…' : 'Compute' }}
            </button>
          </div>
        }
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
      width: min(36rem, 100%);
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
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-shrink: 0;
      padding: 0.9rem 1rem 0.35rem;
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
      margin-top: 0.3rem;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
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

    .icon-btn.spin svg {
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .body {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
      overflow: hidden;
    }

    .banner,
    .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .banner {
      flex-shrink: 0;
      padding: 0.15rem 1rem 0.2rem;
      color: var(--danger);
    }

    .hint {
      padding: 0.35rem 1rem 1rem;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.15rem;
      padding-bottom: 1rem;
    }

    .empty .hint {
      padding-bottom: 0.75rem;
    }

    .empty .btn {
      margin-left: 1rem;
    }

    .day-nav {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
      padding: 0.1rem 0.7rem 0.15rem;
    }

    .day {
      text-align: center;
      font-size: 1.05rem;
      font-weight: 720;
      letter-spacing: -0.02em;
    }

    .gems,
    .activity,
    .elements {
      margin: 0;
      list-style: none;
    }

    .gems {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
      flex-shrink: 0;
      padding: 0.45rem 1rem 0;
    }

    .gems li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.7rem 0.3rem 0.55rem;
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--exercise-gem) 14%, transparent);
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

    .gems .gem {
      --gem-size: 1.2rem;
      background: var(--exercise-gem);
    }

    .gems .count {
      color: var(--exercise-gem);
      font-size: 1.35rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }

    .caption {
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .activity {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
      flex-shrink: 0;
      padding: 0.4rem 1rem 0;
    }

    .activity li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.02rem;
      padding: 0.38rem 0.25rem 0.32rem;
      border-radius: 10px;
      background: rgba(127, 127, 127, 0.06);
    }

    .activity .count {
      font-size: 0.95rem;
      font-weight: 720;
      font-variant-numeric: tabular-nums;
    }

    .activity .caption {
      font-size: 0.66rem;
    }

    .elements {
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: 0.45rem;
      min-height: 0;
      flex: 1 1 auto;
      margin-top: 0.75rem;
      padding: 0.75rem 1rem 1rem;
      overflow: auto;
      border-top: 1px solid var(--border);
    }

    .pill {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem 0.5rem;
      max-width: 100%;
      padding: 0.38rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
    }

    .title {
      font-size: 0.88rem;
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    .bits {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem 0.45rem;
    }

    .bit {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }

    .bit[data-game] {
      color: var(--exercise-gem);
    }

    .bit .gem {
      --gem-size: 0.72rem;
      background: var(--exercise-gem);
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .panel {
        width: 100%;
        max-height: min(40rem, calc(100dvh - 1.3rem));
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class GemStatsModal implements OnDestroy {
  readonly language = input.required<string>();
  readonly closed = output<void>();
  readonly games = GAMES;
  readonly activities = ACTIVITIES;
  readonly snapshot = signal<StatsSnapshot | null>(null);
  readonly dayIndex = signal(0);
  readonly computing = signal(false);
  readonly error = signal(false);

  readonly day = computed(() => this.snapshot()?.days[this.dayIndex()] ?? null);
  readonly canGoOlder = computed(() => {
    const total = this.snapshot()?.days.length ?? 0;
    return this.dayIndex() < total - 1;
  });
  readonly canGoNewer = computed(() => this.dayIndex() > 0);
  readonly dayLabel = computed(() => {
    const current = this.day();
    return current ? formatDay(current.day) : '';
  });
  readonly computedLabel = computed(() => {
    const at = this.snapshot()?.computedAt;
    return at ? formatComputed(at) : '';
  });

  private readonly zone = inject(NgZone);
  private worker: Worker | null = null;
  private request = 0;

  constructor() {
    effect(() => {
      const language = this.language();
      untracked(() => {
        this.retireWorker();
        this.computing.set(false);
        this.error.set(false);
        this.dayIndex.set(0);
        this.snapshot.set(readStatsSnapshot(language));
      });
    });
  }

  ngOnDestroy(): void {
    this.retireWorker();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  compute(): void {
    if (this.computing()) return;
    const language = this.language().trim().toLowerCase();
    if (!language) return;
    this.retireWorker();
    const request = this.request;
    this.error.set(false);
    this.computing.set(true);
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gem-stats.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.computing.set(false);
      this.error.set(true);
      return;
    }
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<StatsMessage>) => {
      this.zone.run(() => {
        if (request !== this.request) return;
        this.finish(event.data, language);
      });
    };
    worker.onerror = () => {
      this.zone.run(() => {
        if (request !== this.request) return;
        this.computing.set(false);
        this.error.set(true);
        this.retireWorker();
      });
    };
    worker.postMessage({ type: 'compile', language });
  }

  older(): void {
    if (!this.canGoOlder()) return;
    this.dayIndex.update((index) => index + 1);
  }

  newer(): void {
    if (!this.canGoNewer()) return;
    this.dayIndex.update((index) => index - 1);
  }

  titleOf(element: ElementDayStats): string {
    return displayTitle(element.title, this.language());
  }

  gemsLabel(game: string, count: number): string {
    const amount = count === 1 ? '1 gem' : `${count} gems`;
    return `${amount}, ${game.toLowerCase()}`;
  }

  private finish(message: StatsMessage, language: string): void {
    this.computing.set(false);
    this.retireWorker();
    if (!message?.ok || !Array.isArray(message.days)) {
      this.error.set(true);
      return;
    }
    const previous = this.day()?.day ?? null;
    const snapshot: StatsSnapshot = { computedAt: Date.now(), days: message.days };
    writeStatsSnapshot(language, snapshot);
    this.snapshot.set(snapshot);
    this.error.set(false);
    if (!previous) {
      this.dayIndex.set(0);
      return;
    }
    const index = message.days.findIndex((day) => day.day === previous);
    this.dayIndex.set(index >= 0 ? index : 0);
  }

  private retireWorker(): void {
    this.request += 1;
    this.worker?.terminate();
    this.worker = null;
  }
}

function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const value = new Date(year, month - 1, date);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((todayStart - value.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  if (year !== today.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(undefined, options).format(value);
}

function formatComputed(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    date,
  );
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `Computed at ${time}`;
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return `Computed ${day} at ${time}`;
}
