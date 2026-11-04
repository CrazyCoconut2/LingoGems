import { Component, input } from '@angular/core';
import type { ElementMode } from 'collection';

/** Icon for Extract, Refine, or Polish. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (mode()) {
        @case (1) {
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        }
        @case (2) {
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
          <circle class="solid" cx="9" cy="7" r="1.7" />
          <circle class="solid" cx="15" cy="12" r="1.7" />
          <circle class="solid" cx="8" cy="17" r="1.7" />
        }
        @default {
          <path d="m12 2.5 1.7 4.8 4.8 1.7-4.8 1.7L12 15.5l-1.7-4.8L5.5 9l4.8-1.7z" />
          <path d="m18.5 14 .9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 1rem;
      height: 1rem;
      color: inherit;
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

    .solid {
      fill: currentColor;
      stroke: none;
    }
  `,
})
export class ModeIcon {
  readonly mode = input.required<ElementMode>();
}
