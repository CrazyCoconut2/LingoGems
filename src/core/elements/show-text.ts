import { Component, input, signal } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';

/** Shows stored text after a click, for this view only. */
@Component({
  selector: 'app-show-text',
  imports: [TranslatePipe],
  template: `
    @if (open()) {
      <span>{{ text() }}</span>
    } @else {
      <button type="button" [attr.aria-label]="label() | translate" (click)="show($event)">
        {{ 'common.show' | translate }}
      </button>
    }
  `,
  styles: `
    :host {
      display: inline;
      color: var(--text);
    }

    button {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
  `,
})
export class ShowText {
  readonly text = input.required<string>();
  readonly label = input('common.show');
  readonly open = signal(false);

  show(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.open.set(true);
  }
}
