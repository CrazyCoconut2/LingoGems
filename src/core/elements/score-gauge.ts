import { Component, computed, input } from '@angular/core';
import { comfortColor } from 'collection';

type GaugeSegment = { transform: string };

/**
 * Ten blocks on a horseshoe, matching the repairability badge:
 * a thick band from the lower left, over the top, to the lower right.
 */
const GAUGE_SEGMENTS: GaugeSegment[] = Array.from({ length: 10 }, (_, index) => {
  const angle = ((205.5 - 25.6 * index) * Math.PI) / 180;
  const x = 32 + Math.cos(angle) * 16.8;
  const y = 28.5 - Math.sin(angle) * 16.8;
  const rot = (Math.atan2(Math.cos(angle), Math.sin(angle)) * 180) / Math.PI;
  return {
    transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(2)})`,
  };
});

@Component({
  selector: 'app-score-gauge',
  template: `
    <svg viewBox="9 5 46 38" aria-hidden="true">
      @for (segment of segments; track $index) {
        <rect
          x="-3.2"
          y="-4"
          width="6.4"
          height="8"
          rx="0.45"
          [class.on]="$index < score()"
          [attr.transform]="segment.transform"
        />
      }
      <text x="32" y="36.4" text-anchor="middle" font-size="15">{{ score() }}</text>
    </svg>
    <span class="of">{{ score() }} / 10</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
      width: 1.7rem;
      height: 1.4rem;
      line-height: 1;
    }

    :host(.md) {
      width: 4.4rem;
      height: 3.63rem;
    }

    :host(.lg) {
      width: 8.4rem;
      height: 6.93rem;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    rect {
      fill: color-mix(in srgb, var(--text) 18%, transparent);
    }

    rect.on {
      fill: currentColor;
    }

    text {
      font-family: inherit;
      font-weight: 800;
      fill: var(--text);
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
    '[class.md]': 'size() === "md"',
    '[class.lg]': 'size() === "lg"',
    '[style.color]': 'tone()',
  },
})
export class ScoreGauge {
  readonly score = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly tone = computed(() => comfortColor(this.score()));
  readonly segments = GAUGE_SEGMENTS;
}
