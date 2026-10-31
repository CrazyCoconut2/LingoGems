import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import packageJson from '../../package.json';

@Component({
  selector: 'app-home',
  template: `
    <main>
      <h1>LingoGem</h1>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    h1 {
      margin: 0;
      font-family: var(--font);
      font-size: 2.5rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      color: var(--text);
    }
  `,
})
export class Home {}

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
