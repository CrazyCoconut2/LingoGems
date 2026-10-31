import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import packageJson from '../../package.json';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <main>
      <h1>LingoGem</h1>
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    h1 {
      margin: 0;
      font-family: system-ui, sans-serif;
      font-size: 2.5rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }
  `,
})
export class App implements OnInit {
  ngOnInit(): void {
    console.log(`LingoGem v${packageJson.version}`);
  }
}
