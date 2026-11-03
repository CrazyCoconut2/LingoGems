import { Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  comfortColorHex,
  normalizeScore,
  sanitizeHighlightColor,
  scoreColorHex,
} from 'collection';

const svgCache = new Map<number, Promise<string>>();

function loadScoreSvg(score: number): Promise<string> {
  const cached = svgCache.get(score);
  if (cached) return cached;
  const pending = fetch(`/scores/${score}.svg`).then((response) => {
    if (!response.ok) throw new Error(`Missing score artwork ${score}`);
    return response.text();
  });
  svgCache.set(score, pending);
  return pending;
}

/** Horseshoe badge for a score from 1 to 10. The artwork lives in `public/scores`. */
@Component({
  selector: 'app-score-gauge',
  template: `
    @if (markup(); as svg) {
      <span class="art" [innerHTML]="svg"></span>
    }
    <span class="of">{{ score() }} / 10</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
      width: 1.7rem;
      height: 1.2rem;
      overflow: hidden;
    }

    :host(.md) {
      width: 3.15rem;
      height: 2.22rem;
    }

    :host(.lg) {
      width: 8.4rem;
      height: 5.91rem;
    }

    .art {
      display: block;
      width: 100%;
      height: 100%;
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
  /** Painted color. When omitted, the saved score color is used. */
  readonly color = input<string | null>(null);
  readonly markup = signal<SafeHtml | null>(null);
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    effect((onCleanup) => {
      const score = normalizeScore(this.score());
      const chosen = sanitizeHighlightColor(this.color()) ?? scoreColorHex(score);
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      void loadScoreSvg(score)
        .then((svg) => {
          if (cancelled) return;
          const painted = svg
            .replaceAll(comfortColorHex(score), chosen)
            .replace('<svg ', '<svg width="100%" height="100%" style="display:block" ');
          this.markup.set(this.sanitizer.bypassSecurityTrustHtml(painted));
        })
        .catch(() => {
          if (!cancelled) this.markup.set(null);
        });
    });
  }
}
