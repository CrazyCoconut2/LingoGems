import { Component, computed, input } from '@angular/core';
import { normalizeDefinitionGem, type DefinitionGem } from 'collection';

const GEM_COLORS: Record<DefinitionGem, string> = {
  'gem-1': '#c8c4bc',
  'gem-2': '#8d5cf6',
  'gem-3': '#3a63f5',
  'gem-4': '#d12b45',
  'gem-5': '#f7fbff',
};

/** A standing rune. The engraving is the color of the gem this rune is cut from. */
@Component({
  selector: 'app-definition-gem',
  template: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="#2f2b27"
        d="M4.15 2.7c0-.45.28-.84.7-.98L8 1.05l3.15.67c.42.14.7.53.7.98v8.7c0 .5-.27.96-.7 1.2L8 14.95l-3.15-2.35a1.35 1.35 0 0 1-.7-1.2z"
      />
      <path
        fill="#5c564e"
        d="M4.55 2.85c0-.32.2-.6.5-.7L8 1.5l2.95.65c.3.1.5.38.5.7v8.4c0 .36-.2.7-.5.86L8 14.35l-2.95-1.24a.95.95 0 0 1-.5-.86z"
      />
      <path
        fill="#8a8174"
        opacity="0.5"
        d="M4.65 3.15c.1-.28.45-.48.8-.6L6.2 2.2v10.35l-.85-.35a.7.7 0 0 1-.4-.62V3.4c0-.1.08-.18.15-.25z"
      />
      <g
        fill="none"
        [attr.stroke]="fill()"
        stroke-width="1.15"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        @switch (mark()) {
          @case ('gem-1') {
            <path d="M8 4.2v6.6" />
            <path d="M8 5.35 10.2 4.15" />
            <path d="M8 7.15 10.2 5.95" />
          }
          @case ('gem-2') {
            <path d="M6.15 4.35 9.85 10.7" />
            <path d="M9.85 4.35 6.15 10.7" />
          }
          @case ('gem-3') {
            <path d="M8 4.05 10.3 7.5 8 10.95 5.7 7.5Z" />
          }
          @case ('gem-4') {
            <path d="M6.05 4.3 9.75 6.4 6.05 8.5 9.75 10.6" />
          }
          @default {
            <path d="M6.15 4.3h3.7" />
            <path d="M8 4.3v6.4" />
            <path d="M6.15 10.7h3.7" />
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
  `,
})
export class DefinitionGemIcon {
  readonly gem = input.required<DefinitionGem>();
  readonly mark = computed(() => normalizeDefinitionGem(this.gem()));
  readonly fill = computed(() => GEM_COLORS[this.mark()]);
}
