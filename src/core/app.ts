import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import packageJson from '../../package.json';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
  `,
})
export class App implements OnInit {
  ngOnInit(): void {
    console.log(`LingoGem v${packageJson.version}`);
  }
}
