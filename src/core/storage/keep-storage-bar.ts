import { Component, inject } from '@angular/core';
import { LanguageService } from '../i18n/language.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { keepStorageFromUser, keepStorageMessage, storageKept } from './keep-storage';

@Component({
  selector: 'app-keep-storage',
  imports: [TranslatePipe],
  template: `
    @if (kept() === false) {
      <div class="keep" role="status">
        <p>{{ message() }}</p>
        <button type="button" class="btn btn-primary" (click)="keep()">
          {{ 'storage.keep' | translate }}
        </button>
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
      border-bottom: 1px solid var(--border);
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
      border-radius: 0.75rem;
    }

    .btn-primary {
      border: 0;
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      box-shadow: 0 10px 15px -3px rgba(244, 63, 94, 0.25);
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(to right, #f43f5e, #ec4899, #7c3aed);
      opacity: 0.95;
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
  private readonly i18n = inject(LanguageService);
  readonly kept = storageKept;

  message(): string {
    return keepStorageMessage((key) => this.i18n.translate(key));
  }

  keep(): void {
    void keepStorageFromUser();
  }
}
