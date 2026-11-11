import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** Hides a translation until the reader clicks it. */
@Component({
  selector: 'app-reveal',
  template: `{{ text() }}`,
  host: {
    '[class.shown]': 'revealed() && !locked()',
    '[class.locked]': 'locked()',
    '(click)': 'reveal($event)',
    '(keydown.enter)': 'reveal($event)',
    '(keydown.space)': 'reveal($event)',
    '[attr.role]': 'revealed() || nested() || locked() ? null : "button"',
    '[attr.tabindex]': 'revealed() || nested() || locked() ? null : 0',
    '[attr.aria-label]': 'revealed() || nested() || locked() ? null : "Show translation"',
    '[attr.aria-hidden]': 'locked() ? true : null',
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

    :host(.locked) {
      pointer-events: none;
      cursor: default;
    }
  `,
})
export class Reveal {
  readonly text = input.required<string>();
  /** Stays blurred and ignores clicks, such as during a game. */
  readonly locked = input(false);
  /** Already unveiled somewhere else that shows the same text. */
  readonly open = input(false);
  readonly unveiled = output<void>();
  readonly shown = signal(false);
  /** Inside a button or link, so this stays a plain label instead of a second control. */
  readonly nested = signal(false);

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

  revealed(): boolean {
    return this.shown() || this.open();
  }

  reveal(event: Event): void {
    if (this.revealed() || this.locked()) return;
    event.preventDefault();
    event.stopPropagation();
    this.shown.set(true);
    this.unveiled.emit();
  }
}
