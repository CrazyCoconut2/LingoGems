import { Component, input, signal } from '@angular/core';

/** Shows stored text after a click, for this view only. */
@Component({
  selector: 'app-show-text',
  template: `
    @if (open()) {
      <span>{{ text() }}</span>
    } @else {
      <button type="button" [attr.aria-label]="label()" (click)="show($event)">Show</button>
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
  readonly label = input('Show');
  readonly open = signal(false);

  show(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.open.set(true);
  }
}
