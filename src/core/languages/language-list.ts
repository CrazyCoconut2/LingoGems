import { Component, computed, ElementRef, OnInit, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  emptyMetadataIndexes,
  isLearnableLanguage,
  LEARNABLE_LANGUAGES,
  languageDisplayName,
  readLanguages,
  saveLanguage,
  type StoredLanguage,
} from 'collection';

@Component({
  selector: 'app-language-list',
  imports: [RouterLink],
  template: `
    <main>
      <header class="brand">
        <span class="gem gem-mark" aria-hidden="true"></span>
        <div class="titles">
          <h1>LingoGems</h1>
          @if (ready() && !languages().length) {
            <p>Set your first language.</p>
          }
        </div>
        <div class="header-actions">
          <a class="settings" routerLink="/settings" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </a>
          @if (ready() && available().length) {
            <button type="button" class="plus" aria-label="Add a language" (click)="openAdd()">
              +
            </button>
          }
        </div>
      </header>

      @if (ready() && languages().length) {
        <ul class="stones">
          @for (language of languages(); track language.code) {
            <li class="stone">
              <a class="enter" [routerLink]="['/languages', language.code]">
                <span class="gem gem-stone" aria-hidden="true"></span>
                <span class="name">{{ displayName(language.code) }}</span>
              </a>
            </li>
          }
        </ul>
      }

      <dialog #adder (click)="closeOnBackdrop($event)" (close)="onDialogClose()">
        <form (submit)="add($event)">
          <div class="modal-head">
            <h2>Add a language</h2>
            <button type="button" class="close" aria-label="Close" (click)="closeAdd()">×</button>
          </div>
          <label for="language">Language</label>
          <select id="language" [value]="selected()" (change)="selected.set(selectValue($event))">
            @for (code of available(); track code) {
              <option [value]="code">{{ displayName(code) }}</option>
            }
          </select>
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
      </dialog>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      width: min(100%, 40rem);
      min-height: 100dvh;
      box-sizing: border-box;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 2rem 1.25rem 2.5rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.9rem;
    }

    .titles {
      flex: 1;
      min-width: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .settings {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 999px;
      color: var(--text-muted);
      text-decoration: none;
    }

    .settings:hover {
      color: var(--text);
      background: rgba(139, 144, 165, 0.16);
    }

    .settings svg {
      width: 1.2rem;
      height: 1.2rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .plus,
    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      cursor: pointer;
    }

    .plus {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      font-size: 1.75rem;
      line-height: 1;
    }

    .plus:hover {
      background: var(--accent-hover);
    }

    h1 {
      margin: 0;
      font-size: 2rem;
      font-weight: 650;
      letter-spacing: -0.04em;
    }

    p {
      margin: 0.2rem 0 0;
      color: var(--muted);
    }

    .stones {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .stone {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.85rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 42%), var(--surface);
    }

    .gem-mark {
      --gem-size: 2.75rem;
    }

    .gem-stone {
      --gem-size: 1.65rem;
    }

    .enter {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.85rem;
      color: inherit;
      text-decoration: none;
    }

    .name {
      min-width: 0;
      font-size: 1.125rem;
      font-weight: 650;
    }

    dialog {
      width: min(100% - 2rem, 24rem);
      margin: auto;
      padding: 1.15rem 1.15rem 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    }

    dialog::backdrop {
      background: rgba(8, 10, 16, 0.72);
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }

    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
    }

    .close {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 1.4rem;
      line-height: 1;
    }

    label {
      font-size: 0.8125rem;
      font-weight: 650;
      color: var(--muted);
    }

    select {
      width: 100%;
      padding: 0.7rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--text);
    }

    form .btn {
      align-self: flex-end;
    }
  `,
})
export class LanguageList implements OnInit {
  private readonly catalog = LEARNABLE_LANGUAGES;
  private readonly adder = viewChild<ElementRef<HTMLDialogElement>>('adder');

  readonly ready = signal(false);
  readonly languages = signal<StoredLanguage[]>([]);
  readonly selected = signal('');
  readonly available = computed(() => {
    const saved = new Set(this.languages().map((language) => language.code));
    return this.catalog.filter((code) => !saved.has(code));
  });

  readonly displayName = languageDisplayName;

  async ngOnInit(): Promise<void> {
    this.languages.set(await readLanguages());
    this.selected.set(this.available()[0] ?? '');
    this.ready.set(true);
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  openAdd(): void {
    this.selected.set(this.available()[0] ?? '');
    this.adder()?.nativeElement.showModal();
  }

  closeAdd(): void {
    this.adder()?.nativeElement.close();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeAdd();
  }

  onDialogClose(): void {
    this.selected.set(this.available()[0] ?? '');
  }

  add(event: Event): void {
    event.preventDefault();
    const code = this.selected().trim().toLowerCase();
    if (!isLearnableLanguage(code) || this.languages().some((language) => language.code === code)) {
      return;
    }
    const created: StoredLanguage = { code, createdAt: Date.now(), ...emptyMetadataIndexes() };
    this.languages.update((list) => [...list, created]);
    this.selected.set(this.available()[0] ?? '');
    this.closeAdd();
    void saveLanguage(created).catch(() => {
      this.languages.update((list) => list.filter((language) => language.code !== code));
      this.selected.set(code);
    });
  }
}
