import { Component, input } from '@angular/core';
import type { ElementMode } from 'collection';

/** The tool for one yield: a sieve, a pickaxe, or a drill. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="58" rx="16" ry="2.4" fill="#090b16" opacity="0.4" />
      @switch (mode()) {
        @case (1) {
          <circle cx="28" cy="49" r="2.1" fill="#e7cb90" />
          <path
            fill="#8a6232"
            d="M36 36.5 54.5 48.2c1.5.9 1.8 2.8.7 4.1l-1.8 2c-1.1 1.3-3.1.9-4.2-.3L32 41.2z"
          />
          <path
            fill="#d7b07a"
            d="M36 35 53 45.6c1.2.8 1.5 2.3.6 3.4l-1.3 1.5c-.9 1-2.5.7-3.4-.3L33 39.2z"
          />
          <path
            fill="#5c6378"
            fill-rule="evenodd"
            d="M28 16c11.2 0 20 6.4 20 14.2S39.2 44.4 28 44.4 8 38 8 30.2 16.8 16 28 16zm0 5.2c8 0 14.2 4.2 14.2 9s-6.2 9-14.2 9-14.2-4.2-14.2-9 6.2-9 14.2-9z"
          />
          <path
            fill="#c5cad6"
            d="M28 16c11.2 0 20 6.4 20 14.2 0 1.2-.4 2.4-1 3.4C44.6 26.2 37.2 21.2 28 21.2S11.4 26.2 9 33.6c-.6-1-1-2.2-1-3.4C8 22.4 16.8 16 28 16z"
          />
          <g fill="none" stroke="#d5d9e4" stroke-width="1.8" stroke-linecap="round">
            <path d="M16.5 29.2h23" />
            <path d="M18 25.2h20" />
            <path d="M18 33.4h20" />
            <path d="M28 22.2v15.2" />
          </g>
          <circle cx="22" cy="27.2" r="2" fill="#e7cb90" />
          <circle cx="33" cy="31.5" r="1.7" fill="#f4f6fb" />
        }
        @case (2) {
          <path fill="#5c5670" d="M6 44h12l2 8H8z" />
          <path fill="#3c3684" d="M12 44h8l2 8h-8z" />
          <path fill="#8a6232" d="M20 56 38 30l7 5L27 61z" />
          <path fill="#d7b07a" d="M20 54.5 36.5 30.5 40 33 23.5 57z" />
          <path fill="#9aa0b4" d="M40 28 8 46l5 7 30-16z" />
          <path fill="#c5cad6" d="M40 28 16 42l2 3 22-14z" />
          <path fill="#e7e9f2" d="M42 26 62 8l-2 8-16 14z" />
          <path fill="#fff" d="M50 18 60 10l-1 4-8 6z" />
          <path fill="#2f2b40" d="M36 26h8l2 8h-8z" />
        }
        @default {
          <path fill="#4a445c" d="M12 48h40l-6 8H18z" />
          <path fill="#2f2b40" d="M32 48h20l-6 8H32z" />
          <path fill="#090b16" d="M28 46h8l-1.2 7h-5.6z" />
          <path fill="#c5cad6" d="M29 24h6v24h-6z" />
          <path fill="#6e7588" d="M24 28h16l-3 4H27zM24 36h16l-3 4H27zM25 44h14l-2 4H27z" />
          <path fill="#f4f6fb" d="M29 28h3v4h-3zM29 36h3v4h-3z" />
          <path fill="#9aa0b4" d="M26 22h12v5H26z" />
          <path fill="#3c3684" d="M22 10h20v14H22z" />
          <path fill="#6c63ff" d="M22 10h12v14H22z" />
          <path fill="#fff" opacity="0.75" d="M24 12h4v6H24z" />
          <path fill="#2b2670" d="M18 8h28v4.5H18z" />
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
