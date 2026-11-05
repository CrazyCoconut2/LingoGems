import { Component, computed, input } from '@angular/core';
import { normalizeDefinitionGem, type DefinitionGem } from 'collection';

const GEM_COLORS: Record<DefinitionGem, string> = {
  'gem-1': '#c8c4bc',
  'gem-2': '#8d5cf6',
  'gem-3': '#3a63f5',
  'gem-4': '#d12b45',
  'gem-5': '#f7fbff',
};

/** One cut stone. The color is the definition's gem. */
@Component({
  selector: 'app-definition-gem',
  template: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path [attr.fill]="fill()" d="M8 1.4 13.2 6.1 8 14.6 2.8 6.1Z" />
      <path fill="#fff" opacity="0.55" d="M8 1.4 10.4 6.1 8 7.2 5.6 6.1Z" />
      <path fill="#090b16" opacity="0.22" d="M8 14.6 13.2 6.1 10.4 6.1 8 7.2Z" />
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
  readonly fill = computed(() => GEM_COLORS[normalizeDefinitionGem(this.gem())]);
}
