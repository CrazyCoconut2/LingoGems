import { Component, OnInit, signal } from '@angular/core';
import { isOnboarded } from './credentials/credentials';
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
  readonly onboarded = signal(isOnboarded());

  ngOnInit(): void {
    document.getElementById('lg-boot-splash')?.remove();
  }
}
