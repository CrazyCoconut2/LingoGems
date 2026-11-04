import { Component, computed, input } from '@angular/core';
import { normalizeDefinitionFrequency, type DefinitionFrequency } from 'collection';

const FREQUENCY_COLORS: Record<DefinitionFrequency, string> = {
  common: '#c8c4bc',
  uncommon: '#8d5cf6',
  rare: '#3a63f5',
  archaic: '#d12b45',
  obsolete: '#f7fbff',
};

/** One cut stone. The color is the sense's frequency. */
@Component({
  selector: 'app-frequency-gem',
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
export class FrequencyGem {
  readonly frequency = input.required<DefinitionFrequency>();
  readonly fill = computed(
    () => FREQUENCY_COLORS[normalizeDefinitionFrequency(this.frequency())],
  );
}
