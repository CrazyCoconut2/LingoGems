import { Component, computed, input } from '@angular/core';

/** Horseshoe badge for a score from 1 to 10. The artwork lives in `public/scores`. */
@Component({
  selector: 'app-score-gauge',
  template: `
    <img [src]="src()" alt="" />
    <span class="of">{{ score() }} / 10</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
      width: 1.7rem;
      height: 1.2rem;
    }

    :host(.md) {
      width: 3.15rem;
      height: 2.22rem;
    }

    :host(.lg) {
      width: 8.4rem;
      height: 5.91rem;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
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
  },
})
export class ScoreGauge {
  readonly score = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly src = computed(() => {
    const score = Math.min(10, Math.max(1, Math.round(Number(this.score())) || 1));
    return `/scores/${score}.svg`;
  });
}
