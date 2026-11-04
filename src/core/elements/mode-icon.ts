import { Component, input } from '@angular/core';
import type { ElementMode } from 'collection';

/** The gem at one stage: a rough find, a cut stone, or a finished gem. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="57" rx="14" ry="2.6" fill="#090b16" opacity="0.4" />
      @switch (mode()) {
        @case (1) {
          <path fill="#c4c0d2" d="M17 44 24 33h16l8 7-3 11H22z" />
          <path fill="#726d82" d="M40 33h8l8 7-3 11-8-8-5-10z" />
          <path fill="#3c3684" d="M27 35 32 16l5 19-5 4z" />
          <path fill="#9d98ff" d="m32 16 5 19-5 4V16z" />
          <path fill="#fff" d="m32 18.5 3.2 12.2L32 33z" />
          <path fill="#e7cb90" d="m11 24 3.2-2.6 12.4 15.2-3.2 2.6z" />
          <path fill="#f4f6fb" d="m7.5 18 8.5-1.5 3.2 6.2-8.2 2.4z" />
          <path fill="#c9ceda" d="m16 16.5 5.2.6-1.6 5.2-4.6-1.6z" />
        }
        @case (2) {
          <path fill="#8d889e" d="M19 17 12 28 22 38 32 22Z" />
          <path fill="#6a657a" d="M12 28 32 54V22L22 38Z" />
          <path fill="#6a6494" d="M45 17 52 28 32 54V22Z" />
          <path fill="#ddd8f2" d="M32 9 45 17 32 22 19 17Z" />
          <path fill="#f7f5ff" d="m32 12 3.2 4h-6.4z" />
        }
        @default {
          <path fill="#2b2670" d="M19 17 12 28 32 54V22Z" />
          <path fill="#6c63ff" d="M45 17 52 28 32 54V22Z" />
          <path fill="#f7f6ff" d="M32 9 45 17 32 22 19 17Z" />
          <path fill="#fff" d="m27.5 13 4.5-1.6 1.2 5.2h-6.4z" />
          <path fill="#fff" d="m51 8 1.15 2.8 2.8 1.15-2.8 1.15L51 16l-1.15-2.9-2.8-1.15 2.8-1.15z" />
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
