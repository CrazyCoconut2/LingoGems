import { Component, input } from '@angular/core';
import type { DefinitionGame } from 'collection';

/** Ruby, topaz, or emerald, matching the gem on the stats cards. */
@Component({
  selector: 'app-gem-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (game()) {
        @case ('translation') {
          <path fill="currentColor" d="M12 1.4 20.6 9.2 12 22.6 3.4 9.2Z" />
          <path fill="#fff" fill-opacity=".7" d="M12 1.4 16.2 9.2 12 8.1 7.8 9.2Z" />
          <path
            fill="#000"
            fill-opacity=".2"
            d="M3.4 9.2 12 22.6 20.6 9.2 16.2 9.2 12 12.4 7.8 9.2Z"
          />
        }
        @case ('example') {
          <path fill="currentColor" d="M12 1.8 20.8 9.6 17.2 21.8H6.8L3.2 9.6Z" />
          <path fill="#fff" fill-opacity=".62" d="M12 1.8 16.4 9.6 12 11.2 7.6 9.6Z" />
          <path
            fill="#000"
            fill-opacity=".18"
            d="M6.8 21.8h10.4L20.8 9.6 16.4 9.6 12 13.2 7.6 9.6 3.2 9.6Z"
          />
        }
        @case ('definition') {
          <path fill="currentColor" d="M7.2 3.1h9.6L21.8 12l-5 8.9H7.2L2.2 12Z" />
          <path fill="#fff" fill-opacity=".62" d="M8.1 3.1h7.8L13.6 8.4h-3.2Z" />
          <path
            fill="#000"
            fill-opacity=".18"
            d="M2.2 12 7.2 20.9h9.6L21.8 12H16.2L12 16.4 7.8 12Z"
          />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: var(--gem-size, 1em);
      height: var(--gem-size, 1em);
      flex: none;
      color: var(--exercise-gem, currentColor);
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class GemIcon {
  readonly game = input.required<DefinitionGame>();
}
