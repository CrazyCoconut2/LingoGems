import { Component, OnInit, signal } from '@angular/core';
import packageJson from '../../package.json';
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
    <p class="version">v{{ version }}</p>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .version {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 20;
      margin: 0;
      padding: 0.12rem 0.75rem calc(0.12rem + env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--bg) 92%, transparent);
      color: var(--text-muted);
      font-size: 0.68rem;
      line-height: 1.2;
      text-align: center;
      pointer-events: none;
    }
  `,
})
export class App implements OnInit {
  readonly version = packageJson.version;
  readonly onboarded = signal(isOnboarded());

  ngOnInit(): void {
    document.getElementById('lg-boot-splash')?.remove();
    console.log(`LingoGems v${packageJson.version}`);
  }
}
