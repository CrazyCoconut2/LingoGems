import { Component, computed, OnInit, signal } from '@angular/core';
import { LEARNABLE_LANGUAGES, languageDisplayName } from './catalog';
import {
  addLanguage,
  readLanguages,
  setLanguageMode,
  type LanguageMode,
  type StoredLanguage,
} from './language-store';

@Component({
  selector: 'app-language-list',
  template: `
    <main>
      <h1>LingoGem</h1>
      @if (!loading()) {
        @if (languages().length) {
          <ul class="languages">
            @for (language of languages(); track language.code) {
              <li>
                <span class="name">{{ displayName(language.code) }}</span>
                <div class="modes" role="group" [attr.aria-label]="displayName(language.code)">
                  <button
                    type="button"
                    [class.is-active]="language.mode === 'settler'"
                    [attr.aria-pressed]="language.mode === 'settler'"
                    (click)="chooseMode(language.code, 'settler')"
                  >
                    Settler
                  </button>
                  <button
                    type="button"
                    [class.is-active]="language.mode === 'explorer'"
                    [attr.aria-pressed]="language.mode === 'explorer'"
                    (click)="chooseMode(language.code, 'explorer')"
                  >
                    Explorer
                  </button>
                </div>
              </li>
            }
          </ul>
        }
        @if (available().length) {
          <form (submit)="add($event)">
            <label for="language">Add a language</label>
            <select
              id="language"
              [value]="selected()"
              (change)="selected.set(selectValue($event))"
            >
              @for (code of available(); track code) {
                <option [value]="code">{{ displayName(code) }}</option>
              }
            </select>
            <button type="submit" class="btn btn-primary">Add</button>
          </form>
        }
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      min-height: 100dvh;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      padding: 2.5rem 1.5rem;
      font-family: var(--font);
      color: var(--text);
    }

    h1 {
      margin: 0;
      font-size: 2.5rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    .languages,
    form {
      width: min(100%, 28rem);
      margin: 0;
      padding: 1.5rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .languages {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      list-style: none;
    }

    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .name {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .modes {
      display: flex;
      gap: 0.5rem;
    }

    .modes button {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.45rem 0.8rem;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }

    .modes button.is-active {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--muted);
    }

    select {
      font: inherit;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--text);
    }

    select:focus {
      outline: 2px solid rgba(var(--accent-rgb), 0.45);
      border-color: var(--accent);
    }

    .btn {
      align-self: flex-end;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 999px;
      padding: 0.6rem 1rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }
  `,
})
export class LanguageList implements OnInit {
  private readonly catalog = LEARNABLE_LANGUAGES;

  readonly loading = signal(true);
  readonly languages = signal<StoredLanguage[]>([]);
  readonly selected = signal('');
  readonly available = computed(() => {
    const saved = new Set(this.languages().map((language) => language.code));
    return this.catalog.filter((code) => !saved.has(code));
  });

  readonly displayName = languageDisplayName;

  async ngOnInit(): Promise<void> {
    const languages = await readLanguages();
    this.languages.set(languages);
    this.selected.set(this.available()[0] ?? '');
    this.loading.set(false);
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  async add(event: Event): Promise<void> {
    event.preventDefault();
    const code = this.selected();
    if (!code) return;
    await addLanguage(code);
    const languages = await readLanguages();
    this.languages.set(languages);
    this.selected.set(this.available()[0] ?? '');
  }

  async chooseMode(code: string, mode: LanguageMode): Promise<void> {
    const current = this.languages().find((language) => language.code === code);
    if (!current || current.mode === mode) return;
    await setLanguageMode(code, mode);
    this.languages.set(await readLanguages());
  }
}
