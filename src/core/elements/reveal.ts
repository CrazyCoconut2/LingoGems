import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { blurTranslationsEnabled } from './blur-translations';

/** Hides a translation until the reader clicks it. */
@Component({
  selector: 'app-reveal',
  template: `{{ text() }}`,
  host: {
    '[class.shown]': 'shown() || !blurred()',
    '(click)': 'reveal($event)',
    '(keydown.enter)': 'reveal($event)',
    '(keydown.space)': 'reveal($event)',
    '[attr.role]': 'shown() || nested() || !blurred() ? null : "button"',
    '[attr.tabindex]': 'shown() || nested() || !blurred() ? null : 0',
    '[attr.aria-label]': 'shown() || nested() || !blurred() ? null : "Show translation"',
  },
  styles: `
    :host {
      display: inline-block;
      filter: blur(0.55em);
      cursor: pointer;
      user-select: none;
      vertical-align: baseline;
      transition: filter 0.12s ease;
    }

    :host(.shown) {
      filter: none;
      cursor: inherit;
      user-select: text;
    }
  `,
})
export class Reveal {
  readonly text = input.required<string>();
  readonly language = input.required<string>();
  readonly shown = signal(false);
  /** Inside a button or link, so this stays a plain label instead of a second control. */
  readonly nested = signal(false);
  readonly blurred = computed(() => blurTranslationsEnabled(this.language()));

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => {
      this.nested.set(!!host.nativeElement.parentElement?.closest('button, a'));
    });
    effect(() => {
      this.text();
      this.shown.set(false);
    });
  }

  reveal(event: Event): void {
    if (this.shown() || !this.blurred()) return;
    event.preventDefault();
    event.stopPropagation();
    this.shown.set(true);
  }
}
