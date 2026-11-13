import { Component, computed, input } from '@angular/core';
import type { ElementMode } from 'collection';

type GemFace = {
  top: string;
  upperLeft: string;
  upperRight: string;
  left: string;
  right: string;
  lowerLeft: string;
  lowerRight: string;
  bottom: string;
  face: string;
  ink: string;
  line: string;
};

/** Translation is a ruby, example an orange stone, definition a green stone. */
const MODE_GEM: Record<ElementMode, GemFace> = {
  1: {
    top: '#ffd0cc',
    upperLeft: '#ff9b98',
    upperRight: '#ff7a7e',
    left: '#f05a62',
    right: '#d63e4a',
    lowerLeft: '#b42c3c',
    lowerRight: '#8e1c2e',
    bottom: '#6a1422',
    face: '#e44550',
    ink: '#fff4f2',
    line: '#4a1018',
  },
  2: {
    top: '#ffe4c8',
    upperLeft: '#ffc48a',
    upperRight: '#ffb066',
    left: '#f09440',
    right: '#d67828',
    lowerLeft: '#b45c16',
    lowerRight: '#8a4010',
    bottom: '#642c08',
    face: '#e88832',
    ink: '#fff6ee',
    line: '#4a240c',
  },
  3: {
    top: '#d8fad4',
    upperLeft: '#9eec9a',
    upperRight: '#78e074',
    left: '#48c850',
    right: '#2ea83c',
    lowerLeft: '#1c8430',
    lowerRight: '#146428',
    bottom: '#0c4418',
    face: '#34b848',
    ink: '#f4fff3',
    line: '#0c3814',
  },
};

/** Top-down cut gem. The mode mark is engraved in the center table. */
@Component({
  selector: 'app-mode-icon',
  template: `
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <polygon points="32.4,7.5 67.6,7.5 59.18,27.83 40.82,27.83" [attr.fill]="gem().top" />
      <polygon points="7.5,32.4 32.4,7.5 40.82,27.83 27.83,40.82" [attr.fill]="gem().upperLeft" />
      <polygon
        points="67.6,7.5 92.5,32.4 72.17,40.82 59.18,27.83"
        [attr.fill]="gem().upperRight"
      />
      <polygon points="7.5,67.6 7.5,32.4 27.83,40.82 27.83,59.18" [attr.fill]="gem().left" />
      <polygon points="92.5,32.4 92.5,67.6 72.17,59.18 72.17,40.82" [attr.fill]="gem().right" />
      <polygon
        points="32.4,92.5 7.5,67.6 27.83,59.18 40.82,72.17"
        [attr.fill]="gem().lowerLeft"
      />
      <polygon
        points="92.5,67.6 67.6,92.5 59.18,72.17 72.17,59.18"
        [attr.fill]="gem().lowerRight"
      />
      <polygon points="67.6,92.5 32.4,92.5 40.82,72.17 59.18,72.17" [attr.fill]="gem().bottom" />
      <polygon
        points="72.17,40.82 72.17,59.18 59.18,72.17 40.82,72.17 27.83,59.18 27.83,40.82 40.82,27.83 59.18,27.83"
        [attr.fill]="gem().face"
      />
      <g class="cut" fill="none" [attr.stroke]="gem().line">
        <polygon points="92.5,32.4 92.5,67.6 67.6,92.5 32.4,92.5 7.5,67.6 7.5,32.4 32.4,7.5 67.6,7.5" />
        <polygon
          points="72.17,40.82 72.17,59.18 59.18,72.17 40.82,72.17 27.83,59.18 27.83,40.82 40.82,27.83 59.18,27.83"
        />
        <polygon points="32.4,7.5 67.6,7.5 59.18,27.83 40.82,27.83" />
        <polygon points="7.5,32.4 32.4,7.5 40.82,27.83 27.83,40.82" />
        <polygon points="67.6,7.5 92.5,32.4 72.17,40.82 59.18,27.83" />
        <polygon points="7.5,67.6 7.5,32.4 27.83,40.82 27.83,59.18" />
        <polygon points="92.5,32.4 92.5,67.6 72.17,59.18 72.17,40.82" />
        <polygon points="32.4,92.5 7.5,67.6 27.83,59.18 40.82,72.17" />
        <polygon points="92.5,67.6 67.6,92.5 59.18,72.17 72.17,59.18" />
        <polygon points="67.6,92.5 32.4,92.5 40.82,72.17 59.18,72.17" />
      </g>
      <g
        class="mark"
        fill="none"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        transform="translate(50 50) scale(1.45) translate(-12 -12)"
      >
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
              d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
            />
            <path
              d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
            />
          }
          @default {
            <path
              d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
            />
            <path d="m8 13 4-7 4 7" />
            <path d="M9.1 11h5.7" />
          }
        }
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

    .cut {
      stroke-width: 1.35;
      stroke-linejoin: round;
    }

    .mark {
      stroke: var(--gem-ink);
    }

    :host(.scintillate) .mark {
      animation: mark-scintillate 1s linear infinite;
    }

    @keyframes mark-scintillate {
      0%,
      62%,
      100% {
        stroke: var(--gem-ink);
      }

      74%,
      86% {
        stroke: #fff;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :host(.scintillate) .mark {
        animation: none;
      }
    }
  `,
  host: {
    '[style.--gem-ink]': 'gem().ink',
  },
})
export class ModeIcon {
  readonly mode = input.required<ElementMode>();
  readonly gem = computed(() => MODE_GEM[this.mode()]);
}
