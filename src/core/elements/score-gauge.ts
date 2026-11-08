import { Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { comfortColor } from './comfort-palette';

const UNFILLED = '#3a415c';

const svgCache = new Map<number, Promise<string>>();

/** Integer 1–10. Anything else is 1. */
function normalizeScore(value: unknown): number {
  const score = Math.round(Number(value));
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : 1;
}

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

/** Recolors the filled horseshoe segments. The empty segments stay dark. */
function paintScore(svg: string, color: string): string {
  return svg
    .replace(/fill="(#[0-9a-fA-F]{6})"/g, (match, fill: string) =>
      fill.toLowerCase() === UNFILLED ? match : `fill="${color}"`,
    )
    .replace('<svg ', '<svg width="100%" height="100%" style="display:block" ');
}

/** Horseshoe badge for a comfort score from 1 to 10. The artwork lives in `public/scores`. */
@Component({
  selector: 'app-score-gauge',
  template: `
    @if (markup(); as svg) {
      <span class="art" [innerHTML]="svg"></span>
    }
  `,
  styles: `
    :host {
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
  `,
  host: {
    role: 'img',
    '[class.md]': 'size() === "md"',
    '[class.lg]': 'size() === "lg"',
    '[attr.aria-label]': '"Comfort " + score() + " of 10"',
  },
})
export class ScoreGauge {
  readonly score = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly markup = signal<SafeHtml | null>(null);
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    effect((onCleanup) => {
      const score = normalizeScore(this.score());
      const chosen = comfortColor(score);
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      void loadScoreSvg(score)
        .then((svg) => {
          if (cancelled) return;
          this.markup.set(this.sanitizer.bypassSecurityTrustHtml(paintScore(svg, chosen)));
        })
        .catch(() => {
          if (!cancelled) this.markup.set(null);
        });
    });
  }
}
