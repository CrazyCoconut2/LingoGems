import { Component, computed, input, output } from '@angular/core';
import {
  definitionScoreAverage,
  definitionScoreStep,
  displayTitle,
  formTexts,
  highlightDefinitionPassage,
  type DefinitionHighlightMatch,
  type StoredElement,
} from 'collection';

/** One passage with the same element highlights as a definition or example. */
@Component({
  selector: 'app-highlighted-text',
  template: `
    @for (part of parts(); track $index) {
      @if (part.matches.length > 1) {
        <button
          type="button"
          class="linguagem-highlighted"
          [class.linguagem-highlighted--muted]="part.muted"
          [style.--score-color]="part.muted ? null : part.color || null"
          [textContent]="part.text"
          (click)="collide($event, part.matches)"
        ></button>
      } @else if (part.matches.length === 1 && !part.current) {
        <button
          type="button"
          class="linguagem-highlighted"
          [class.linguagem-highlighted--muted]="part.muted"
          [style.--score-color]="part.muted ? null : part.color || null"
          [textContent]="part.text"
          (click)="open($event, part.matches[0].elementId)"
        ></button>
      } @else if (part.current) {
        <span
          class="linguagem-highlighted linguagem-highlighted--current"
          [class.linguagem-highlighted--muted]="part.muted"
          [style.--score-color]="part.muted ? null : part.color || null"
          [textContent]="part.text"
        ></span>
      } @else {
        <span [textContent]="part.text"></span>
      }
    }
  `,
  styles: `
    :host {
      display: inline;
    }

    .linguagem-highlighted {
      background: transparent;
      color: inherit;
      border-bottom: none;
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-color: oklch(
        from var(--score-color, var(--accent)) 0.74 calc(min(max(c, 0.16), 0.24)) h
      );
      text-decoration-thickness: 2px;
      text-underline-offset: 0.18em;
    }

    .linguagem-highlighted--muted {
      text-decoration-color: var(--text-muted);
    }

    button.linguagem-highlighted {
      display: inline;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
      text-align: inherit;
    }

    .linguagem-highlighted--current {
      text-decoration: none;
      border-radius: 0.18em;
      padding: 0 0.12em;
      background: color-mix(
        in srgb,
        oklch(from var(--score-color, var(--accent)) 0.68 calc(min(max(c, 0.13), 0.18)) h) 42%,
        transparent
      );
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
  `,
})
export class HighlightedText {
  readonly text = input('');
  readonly element = input.required<StoredElement>();
  readonly collection = input<StoredElement[]>([]);
  readonly opened = output<{ id: string; phrase: string }>();
  readonly collided = output<{
    event: MouseEvent;
    matches: DefinitionHighlightMatch[];
    phrase: string;
  }>();

  readonly parts = computed(() => {
    const element = this.element();
    const shown = displayTitle(this.text(), element.language);
    const others = this.collection()
      .filter((item) => item.id !== element.id)
      .map((item) => ({
        id: item.id,
        title: item.title,
        forms: elementFormTexts(item),
        ...scoreColor(item),
      }));
    return highlightDefinitionPassage(
      shown,
      {
        id: element.id,
        title: element.title,
        forms: elementFormTexts(element),
        ...scoreColor(element),
      },
      others,
    );
  });

  open(event: MouseEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.opened.emit({ id, phrase: this.text() });
  }

  collide(event: MouseEvent, matches: DefinitionHighlightMatch[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.collided.emit({ event, matches, phrase: this.text() });
  }
}

function scoreColor(element: StoredElement): { color: string; muted: boolean } {
  if (element.deletedAt) return { color: '', muted: true };
  const average = definitionScoreAverage(element);
  if (average == null) return { color: '', muted: false };
  return { color: `var(--score-${definitionScoreStep(average)})`, muted: false };
}

function elementFormTexts(element: StoredElement): string[] {
  return element.definitions.flatMap((definition) => formTexts(definition.forms));
}
