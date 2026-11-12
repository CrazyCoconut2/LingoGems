import { Component, NgZone, OnDestroy, OnInit, inject, output, signal } from '@angular/core';
import type { GemStats } from './gem-stats.worker';

type GemGame = keyof GemStats;

const GAMES: readonly { game: GemGame; label: string }[] = [
  { game: 'translation', label: 'Translation' },
  { game: 'example', label: 'Example' },
  { game: 'definition', label: 'Definition' },
];

type StatsMessage = { ok: true; stats: GemStats } | { ok: false };

@Component({
  selector: 'app-gem-stats',
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Gem stats"
      [attr.aria-busy]="stats() || error() ? null : true"
      (click)="closeOnBackdrop($event)"
    >
      <section class="panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div>
            <h2>Gems</h2>
            <p>Translation, example, and definition gems across the collection.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>
        <div class="body">
          @if (error()) {
            <p class="hint">Could not count gems.</p>
          } @else if (stats(); as totals) {
            <ul class="totals">
              @for (row of games; track row.game) {
                <li [attr.data-game]="row.game">
                  <span class="gem" aria-hidden="true"></span>
                  <span class="label">{{ row.label }}</span>
                  <span class="count">{{ totals[row.game] }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="hint">Counting gems…</p>
          }
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
      width: min(22rem, 100%);
      margin-top: auto;
      margin-bottom: auto;
      display: flex;
      flex-direction: column;
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
      padding: 0.9rem 1.15rem 0.4rem;
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

    .panel-header p,
    .hint {
      margin-top: 0.4rem;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .hint {
      margin: 0;
      padding: 0.35rem 1.15rem 1.15rem;
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
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .totals {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0;
      padding: 0.55rem 0.7rem 1rem;
      list-style: none;
    }

    .totals li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.7rem;
      padding: 0.45rem 0.5rem;
    }

    .totals li[data-game='translation'] {
      --exercise-gem: var(--gem-translation);
    }

    .totals li[data-game='example'] {
      --exercise-gem: var(--gem-example);
    }

    .totals li[data-game='definition'] {
      --exercise-gem: var(--gem-definition);
    }

    .totals .gem {
      --gem-size: 1.15rem;
      background: var(--exercise-gem);
    }

    .label {
      font-weight: 650;
    }

    .count {
      color: var(--exercise-gem);
      font-size: 1.05rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 720px) {
      .backdrop {
        align-items: flex-end;
        padding: 0.65rem;
      }

      .panel {
        width: 100%;
        margin-top: auto;
        margin-bottom: 0;
        border-radius: 14px 14px 0 0;
      }
    }
  `,
})
export class GemStatsModal implements OnInit, OnDestroy {
  readonly closed = output<void>();
  readonly games = GAMES;
  readonly stats = signal<GemStats | null>(null);
  readonly error = signal(false);

  private readonly zone = inject(NgZone);
  private worker: Worker | null = null;

  ngOnInit(): void {
    const worker = new Worker(new URL('./gem-stats.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<StatsMessage>) => {
      this.zone.run(() => this.apply(event.data));
    };
    worker.onerror = () => {
      this.zone.run(() => this.error.set(true));
    };
    worker.postMessage({ type: 'compile' });
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  private apply(message: StatsMessage): void {
    if (!this.worker) return;
    if (!message?.ok) {
      this.error.set(true);
      return;
    }
    this.stats.set(message.stats);
  }
}
