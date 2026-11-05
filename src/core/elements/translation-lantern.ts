import { Component } from '@angular/core';

/** A lantern whose light is the translation mark. */
@Component({
  selector: 'app-translation-lantern',
  template: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#8a8174" d="M7.2.25h1.6v.7H7.2z" />
      <path fill="#5e574e" d="M5.7.9h4.6v.85H5.7z" />
      <path fill="#3f3a34" d="M2.7 1.8h10.6l.75 1.2H1.95z" />
      <path fill="#4a443c" d="M2.55 3.1h10.9v8.35c0 .5-.45.9-1 .9H3.55c-.55 0-1-.4-1-.9z" />
      <path fill="#2a1608" d="M3.35 3.75h9.3v7c0 .3-.25.55-.55.55H3.9c-.3 0-.55-.25-.55-.55z" />
      <path fill="#5e574e" d="M2.9 12.45h10.2v.75c0 .32-.42.6-.95.6H3.85c-.53 0-.95-.28-.95-.6z" />
      <g fill="none" stroke="#ffe7a3" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.15 5.15h3.15" />
        <path d="M5.45 4.25h.55" />
        <path d="M4.45 6.05 6.45 8.25" />
        <path d="M4.25 8.35 6.2 6.15 6.95 5.15" />
      </g>
      <path
        fill="#fff6d0"
        fill-rule="evenodd"
        d="M12.15 11.35 9.85 5.55 7.55 11.35h1.15l.4-1.15h1.9l.4 1.15zm-2.7-2.15h1.1L9.85 7.35z"
      />
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
export class TranslationLantern {}
