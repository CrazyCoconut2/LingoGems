import { Component } from '@angular/core';

/** Eye with the translation mark, for a revealed phrase. */
@Component({
  selector: 'app-reveal-icon',
  template: `
    <svg viewBox="0 0 46 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      <g transform="translate(22)">
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 1.82rem;
      height: 0.95rem;
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
  `,
})
export class RevealIcon {}
