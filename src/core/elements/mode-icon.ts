import { Component, input } from '@angular/core';
import type { ElementMode } from 'collection';

/** The gem at one stage: a rough find, a cut stone, or a finished gem. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      @switch (mode()) {
        @case (1) {
          <ellipse cx="34" cy="54" rx="18" ry="4.2" fill="#2a2640" />
          <path
            fill="#8d879c"
            d="M18 46c-1-10 6-18 13-20 1-6 8-9 14-7 8 2 14 9 13 18 2 7-3 13-9 15-4 3-9 4-14 3-9-1-17-3-17-9z"
          />
          <path
            fill="#6e687e"
            d="M24 34c2-4 8-6 12-4 2 6 1 12-3 15-5 1-10-2-9-11z"
          />
          <path fill="#6c63ff" d="M33 36l7 1.5-1.5 7.5-6.5-.5z" />
          <path
            d="M14 16 34 34"
            fill="none"
            stroke="#e2c48a"
            stroke-width="4.2"
            stroke-linecap="round"
          />
          <path fill="#e7ebf6" d="m9 14 11 1 1 8-9-2z" />
          <path fill="#c5cad8" d="m9 14 6-7 6 4-4 6z" />
        }
        @case (2) {
          <path fill="#5c568c" d="M16 16 10 30 32 56 32 30Z" />
          <path fill="#7a74b0" d="M48 16 54 30 32 56 32 30Z" />
          <path fill="#a39ed4" d="M32 8 48 16 32 30 16 16Z" />
          <path
            d="M32 8v48M16 16h32M10 30h44M16 16 32 56 48 16"
            fill="none"
            stroke="#2e2a52"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path fill="#e7ebf6" d="M50 20h9v4.5h-9z" />
          <path fill="#e2c48a" d="m46 21 6 .6-.6 3.6-6-.6z" />
        }
        @default {
          <path fill="#322c74" d="M16 16 10 30 32 56 32 30Z" />
          <path fill="#7d77ef" d="M48 16 54 30 32 56 32 30Z" />
          <path fill="#f4f2ff" d="M32 8 48 16 32 30 16 16Z" />
          <path fill="#fff" opacity="0.9" d="m24 14 6-3 1 7-5 1z" />
          <path fill="#fff" d="m50 6 1.3 3.2 3.2 1.3-3.2 1.3L50 15l-1.3-3.2-3.2-1.3 3.2-1.3z" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class ModeIcon {
  readonly mode = input.required<ElementMode>();
}
