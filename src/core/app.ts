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
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
  `,
})
export class App implements OnInit {
  ngOnInit(): void {
    document.getElementById('lg-boot-splash')?.remove();
    console.log(`LingoGems v${packageJson.version}`);
  }
}
