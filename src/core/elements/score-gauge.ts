import { Component, computed, input } from '@angular/core';
import { comfortColor } from 'collection';

/** Semicircular score, filled from 1 to 10 and colored on the comfort scale. */
@Component({
  selector: 'app-score-gauge',
  template: `
    <svg viewBox="0 0 64 42" aria-hidden="true">
      <path class="track" pathLength="10" d="M 8 34 A 24 24 0 0 1 56 34" />
      <path
        class="fill"
        pathLength="10"
        [attr.stroke-dasharray]="score() + ' 10'"
        d="M 8 34 A 24 24 0 0 1 56 34"
      />
    </svg>
    <span class="num"> {{ score() }}<span class="of"> / 10</span> </span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
      width: 2.7rem;
      height: 1.9rem;
      line-height: 1;
    }

    :host(.lg) {
      width: 8.5rem;
      height: 5.7rem;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    path {
      fill: none;
      stroke-linecap: round;
      stroke-width: 7;
    }

    .track {
      stroke: color-mix(in srgb, currentColor 24%, transparent);
    }

    .fill {
      stroke: currentColor;
    }

    .num {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      text-align: center;
      font-weight: 750;
      font-size: 0.82rem;
      letter-spacing: -0.04em;
    }

    :host(.lg) .num {
      bottom: 0.1rem;
      font-size: 2.4rem;
    }

    .of {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `,
  host: {
    '[class.lg]': 'size() === "lg"',
    '[style.color]': 'tone()',
  },
})
export class ScoreGauge {
  readonly score = input.required<number>();
  readonly size = input<'sm' | 'lg'>('sm');
  readonly tone = computed(() => comfortColor(this.score()));
}
