import { Component, computed, input } from '@angular/core';
import { elementModeLabel, type ElementMode } from 'collection';
import { DEFAULT_STEP_GOAL, MAX_STEP_GOAL, MIN_STEP_GOAL } from './step-goal';

/** Succeeded exercises out of the goal for one mode. Display only. */
@Component({
  selector: 'app-mode-progress',
  template: `
    <div
      class="progress"
      [class.compact]="compact()"
      role="img"
      [attr.aria-label]="modeLabel(mode()) + ', ' + shown() + ' of ' + total()"
      [style.--mode-color]="color()"
    >
      <span class="track" aria-hidden="true">
        <span class="fill" [style.width.%]="percent()"></span>
      </span>
      @if (labeled()) {
        <span class="ratio" aria-hidden="true">{{ shown() }}/{{ total() }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.22rem;
      width: 4.6rem;
    }

    .track {
      display: block;
      width: 100%;
      height: 0.38rem;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(139, 144, 165, 0.28);
    }

    .fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--mode-color, var(--accent));
    }

    .ratio {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .compact {
      width: 2.5rem;
      gap: 0.12rem;
    }

    .compact .track {
      height: 0.22rem;
    }
  `,
})
export class ModeProgress {
  readonly mode = input.required<ElementMode>();
  readonly succeeded = input(0);
  readonly goal = input(DEFAULT_STEP_GOAL);
  readonly color = input.required<string>();
  readonly compact = input(false);
  /** The ratio is shown only while choosing a mode. */
  readonly labeled = input(false);
  readonly modeLabel = elementModeLabel;

  readonly total = computed(() => {
    const goal = Math.round(Number(this.goal()));
    if (!Number.isInteger(goal) || goal < MIN_STEP_GOAL || goal > MAX_STEP_GOAL)
      return DEFAULT_STEP_GOAL;
    return goal;
  });

  readonly shown = computed(() => {
    const value = Math.round(Number(this.succeeded()));
    const count = Number.isInteger(value) && value > 0 ? value : 0;
    return Math.min(this.total(), count);
  });

  readonly percent = computed(() => (this.shown() / this.total()) * 100);
}
