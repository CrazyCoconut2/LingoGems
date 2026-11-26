import { Component, OnInit, inject, signal } from '@angular/core';
import { isOnboarded } from './credentials/credentials';
import { LanguageService } from './i18n/language.service';
import { LanguagePage } from './languages/language-page';
import { Onboarding } from './onboarding/onboarding';
import { KeepStorageBar } from './storage/keep-storage-bar';

@Component({
  selector: 'app-root',
  imports: [KeepStorageBar, Onboarding, LanguagePage],
  template: `
    <app-keep-storage />
    @if (onboarded()) {
      <app-language-page />
    } @else {
      <app-onboarding (finished)="onboarded.set(true)" />
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    app-language-page,
    app-onboarding {
      min-height: 0;
    }
  `,
})
export class App implements OnInit {
  private readonly i18n = inject(LanguageService);
  readonly onboarded = signal(isOnboarded());

  ngOnInit(): void {
    document.documentElement.lang = this.i18n.currentLanguage;
    document.getElementById('lg-boot-splash')?.remove();
  }
}
