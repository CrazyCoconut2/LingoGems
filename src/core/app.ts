import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import packageJson from '../../package.json';
import { KeepStorageBar } from './storage/keep-storage-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, KeepStorageBar],
  template: `
    <app-keep-storage />
    <router-outlet />
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
      z-index: 60;
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

  ngOnInit(): void {
    document.getElementById('lg-boot-splash')?.remove();
    console.log(`LingoGems v${packageJson.version}`);
  }
}
