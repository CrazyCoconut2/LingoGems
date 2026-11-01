import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ElementMetadata, StoredElement } from 'collection';

@Component({
  selector: 'app-element-modal',
  template: `
    <div
      class="backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="element().title"
      (click)="onBackdrop($event)"
    >
      <div class="panel">
        <header>
          <h2>{{ element().title }}</h2>
          <button
            #closeButton
            type="button"
            class="close"
            aria-label="Close"
            (click)="closed.emit()"
          >
            ×
          </button>
        </header>
        <div class="body">
          @if (element().definitions.length) {
            <ol class="definitions">
              @for (definition of element().definitions; track $index) {
                <li>
                  @if (definition.equivalent) {
                    <p class="equivalent">{{ definition.equivalent }}</p>
                  }
                  <p>{{ definition.text }}</p>
                  @if (definition.translation) {
                    <p class="translation">{{ definition.translation }}</p>
                  }
                  @if (definition.forms.length) {
                    <ul class="forms">
                      @for (form of definition.forms; track form) {
                        <li>{{ form }}</li>
                      }
                    </ul>
                  }
                  @if (definition.examples.length) {
                    <ul class="examples">
                      @for (example of definition.examples; track $index) {
                        <li>
                          <q>{{ example.text }}</q>
                          @if (entries(example.metadata); as meta) {
                            @if (meta.length) {
                              <dl>
                                @for (entry of meta; track entry.key) {
                                  <div>
                                    <dt>{{ entry.key }}</dt>
                                    <dd>{{ entry.value }}</dd>
                                  </div>
                                }
                              </dl>
                            }
                          }
                        </li>
                      }
                    </ul>
                  }
                  @if (entries(definition.metadata); as meta) {
                    @if (meta.length) {
                      <dl>
                        @for (entry of meta; track entry.key) {
                          <div>
                            <dt>{{ entry.key }}</dt>
                            <dd>{{ entry.value }}</dd>
                          </div>
                        }
                      </dl>
                    }
                  }
                </li>
              }
            </ol>
          } @else {
            <p class="empty">No definitions yet.</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
    }

    .backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 1.25rem;
      background: rgba(8, 10, 16, 0.78);
      backdrop-filter: blur(6px);
    }

    .panel {
      display: flex;
      flex-direction: column;
      width: min(100%, 42rem);
      height: min(90dvh, calc(100dvh - 2.5rem));
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background: var(--surface);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.15rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      margin: 0;
      min-width: 0;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .close {
      display: grid;
      place-items: center;
      flex: none;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
    }

    .close:hover {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .body {
      min-height: 0;
      overflow: auto;
      padding: 1rem 1.15rem 1.25rem;
    }

    .empty {
      margin: 0;
      color: var(--muted);
    }

    .definitions {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .definitions > li {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      padding: 0.9rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--bg) 72%, var(--surface));
    }

    p {
      margin: 0;
    }

    .equivalent {
      font-weight: 650;
      letter-spacing: -0.02em;
    }

    .translation {
      color: var(--text-muted);
    }

    .forms,
    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .forms li {
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .examples {
      flex-direction: column;
      gap: 0.55rem;
    }

    q {
      quotes: '“' '”';
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.8rem;
      margin: 0.35rem 0 0;
    }

    dl div {
      display: flex;
      gap: 0.35rem;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    dt {
      font-weight: 650;
    }

    dd {
      margin: 0;
    }
  `,
})
export class ElementModal {
  readonly element = input.required<StoredElement>();
  readonly closed = output<void>();

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => {
      document.body.style.overflow = previous;
    });
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  entries(metadata: ElementMetadata): Array<{ key: string; value: string }> {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  }
}
