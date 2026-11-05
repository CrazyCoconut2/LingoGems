import { Component } from '@angular/core';

/** A stone with the translation mark engraved in the face. */
@Component({
  selector: 'app-translation-rune',
  template: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="14.7" rx="3.6" ry="0.55" fill="#090b16" opacity="0.35" />
      <path
        fill="#c3beb4"
        d="M8 .7c3.6 0 5.5 1.8 5.7 4.4l.4 5.2c.1 2.8-2.4 4.8-6.1 4.8S2 13.1 2.1 10.3l.4-5.2C2.5 2.5 4.4.7 8 .7Z"
      />
      <path
        fill="#f7f4ee"
        opacity="0.65"
        d="M8 1.3c1.8 0 3.3.7 4.2 1.8-1.2 1-2.6 1.5-4.2 1.5S5 4.1 3.8 3.1C4.7 2 6.2 1.3 8 1.3Z"
      />
      <path
        fill="#090b16"
        opacity="0.16"
        d="M8 15.1c2.4 0 4.2-1 4.7-2.6l-.2-3.4c.7.9.9 2 .8 3.2-.2 2-2.3 3.8-5.3 3.8z"
      />
      <ellipse cx="8" cy="8.3" rx="5" ry="4.5" fill="#090b16" opacity="0.13" />
      <g
        fill="none"
        stroke="#2c2824"
        stroke-width="0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3.8 5.26h5.04" />
        <path d="M5.9 4h.42" />
        <path d="M5.06 6.52 7.58 9.04" />
        <path d="M4.64 9.04 7.16 6.52 8 5.26" />
        <path d="M12.2 12.4 10.1 8.2 8 12.4" />
        <path d="M8.84 10.72h2.52" />
      </g>
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
export class TranslationRune {}
