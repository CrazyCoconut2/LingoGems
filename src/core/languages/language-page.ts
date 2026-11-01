import { Component, inject } from '@angular/core';
import { ActivatedRoute, CanActivateFn, Router, RouterLink } from '@angular/router';
import { languageDisplayName, readLanguages } from 'collection';

const ELEMENT_SKELETONS = [0, 1, 2, 3, 4, 5, 6, 7];

export const openSavedLanguage: CanActivateFn = async (route) => {
  const code = String(route.paramMap.get('code') ?? '')
    .trim()
    .toLowerCase();
  const languages = await readLanguages();
  if (languages.some((language) => language.code === code)) return true;
  return inject(Router).createUrlTree(['/']);
};

@Component({
  selector: 'app-language-page',
  imports: [RouterLink],
  template: `
    <main>
      <a class="back" routerLink="/" [attr.aria-label]="'Back to languages'">
        <span class="gem gem-mark" aria-hidden="true"></span>
        <span>{{ name }}</span>
      </a>

      <form class="search-bar" (submit)="$event.preventDefault()">
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </span>
        <input
          type="search"
          name="entry"
          placeholder="Search lemmas or forms…"
          aria-label="Search lemmas or forms"
        />
      </form>

      <ul class="elements" aria-hidden="true">
        @for (item of skeletons; track item) {
          <li class="element">
            <span class="bone bone-title"></span>
            <span class="bone bone-meta"></span>
          </li>
        }
      </ul>
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
      gap: 0.85rem;
      padding: 1rem 1.25rem 1.5rem;
    }

    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      width: fit-content;
      color: var(--text);
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      text-decoration: none;
    }

    .gem-mark {
      --gem-size: 1.35rem;
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      height: 2.4rem;
      padding: 0.2rem 0.65rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .search-bar:focus-within {
      border-color: rgba(var(--accent-rgb), 0.55);
    }

    .search-icon {
      display: inline-flex;
      color: var(--text-muted);
    }

    .search-bar:focus-within .search-icon {
      color: var(--accent-text);
    }

    input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      font-size: 0.9rem;
      outline: none;
    }

    input::-webkit-search-cancel-button,
    input::-webkit-search-decoration {
      appearance: none;
    }

    input::placeholder {
      color: var(--text-muted);
    }

    .elements {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .element {
      box-sizing: border-box;
      height: 5.35rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.55rem;
      padding: 0 1rem;
      border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-left: 3px solid color-mix(in srgb, var(--text) 7%, transparent);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--bg) 72%, var(--surface));
    }

    .bone {
      display: block;
      height: 0.7rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 10%, transparent);
    }

    .bone-title {
      width: 58%;
      height: 0.95rem;
    }

    .bone-meta {
      width: 34%;
    }
  `,
})
export class LanguagePage {
  private readonly route = inject(ActivatedRoute);

  readonly skeletons = ELEMENT_SKELETONS;
  readonly name = languageDisplayName(this.route.snapshot.paramMap.get('code') ?? '');
}
