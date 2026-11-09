import { Component, computed } from '@angular/core';
import { keepStorageFromUser, keepStorageMessage, storageKept } from './keep-storage';

@Component({
  selector: 'app-keep-storage',
  template: `
    @if (kept() === false) {
      <div class="keep" role="status">
        <p>{{ message() }}</p>
        <button type="button" class="btn btn-primary" (click)="keep()">Keep data</button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: 25;
    }

    .keep {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
      padding: calc(0.75rem + env(safe-area-inset-top, 0px))
        max(1.25rem, env(safe-area-inset-right, 0px)) 0.75rem
        max(1.25rem, env(safe-area-inset-left, 0px));
      background: var(--surface);
      border-bottom: 1px solid var(--accent-border);
      box-shadow: var(--shadow);
    }

    p {
      flex: 1;
      min-width: 0;
      margin: 0;
      line-height: 1.4;
      color: var(--text);
    }

    .btn {
      flex: none;
    }

    @media (max-width: 640px) {
      .keep {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `,
})
export class KeepStorageBar {
  readonly kept = storageKept;
  readonly message = computed(keepStorageMessage);

  keep(): void {
    void keepStorageFromUser();
  }
}
