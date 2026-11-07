import { Component, input } from '@angular/core';
import type { ElementMode } from 'collection';

/** Translation, form, or definition. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (mode()) {
        @case (1) {
          <path d="m5 8 6 6" />
          <path d="m4 14 6-6 2-3" />
          <path d="M2 5h12" />
          <path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" />
          <path d="M14 18h6" />
        }
        @case (2) {
          <path
            d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
          />
          <path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5" />
          <path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5" />
        }
        @default {
          <path
            d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
          />
          <path d="m8 13 4-7 4 7" />
          <path d="M9.1 11h5.7" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
      color: currentColor;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class ModeIcon {
  readonly mode = input.required<ElementMode>();
}
