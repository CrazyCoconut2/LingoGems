import { Component, effect, input, output, signal } from '@angular/core';
import { ELEMENT_COLOR_PRESETS, sanitizeElementColor } from 'collection';

/** Starting swatch for a custom color that has not been chosen yet. */
const DEFAULT_COLOR = '#6c63ff';

/** Saturation and hue picker for one highlight color. Reset clears it. */
@Component({
  selector: 'app-highlight-color-picker',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Highlight color',
    '(click)': '$event.stopPropagation()',
  },
  template: `
    <p class="picker-label">Colors</p>
    <div class="color-presets" role="list" aria-label="Existing colors">
      @for (preset of existingColors(); track preset) {
        <button
          type="button"
          class="color-preset"
          role="listitem"
          [class.selected]="!cleared() && !customOpen() && draft() === preset"
          [style.background]="preset"
          [disabled]="disabled()"
          [attr.aria-label]="preset"
          [attr.aria-pressed]="!cleared() && !customOpen() && draft() === preset"
          (click)="pickPreset(preset)"
        ></button>
      }
    </div>
    <p class="picker-label">Custom color</p>
    <div
      class="color-sv"
      [style.background]="svBackground()"
      (pointerdown)="onSvPointer($event)"
      (pointermove)="onSvPointer($event)"
      role="slider"
      aria-label="Custom color"
      [attr.aria-valuetext]="shown()"
    >
      <span
        class="color-sv-thumb"
        [style.left.%]="sat() * 100"
        [style.top.%]="(1 - val()) * 100"
        [style.background]="shown()"
      ></span>
    </div>
    <input
      class="color-hue"
      type="range"
      min="0"
      max="360"
      step="1"
      aria-label="Hue"
      [value]="hue()"
      [disabled]="disabled()"
      (input)="onHueInput($event)"
    />
    <button type="button" class="picker-btn" [disabled]="disabled() || !canReset()" (click)="reset()">
      Reset
    </button>
    <div class="picker-actions">
      <button type="button" class="picker-btn" [disabled]="disabled()" (click)="dismissed.emit()">
        Cancel
      </button>
      <button
        type="button"
        class="picker-btn picker-btn-primary"
        [disabled]="saveDisabled()"
        (click)="confirm()"
      >
        Save
      </button>
    </div>
  `,
  styles: `
    :host {
      cursor: default;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.45rem;
      width: min(100%, 19.5rem);
      max-height: min(100%, 34rem);
      min-height: 0;
      padding: 0.75rem 0.9rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 2px);
      background: var(--surface);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
      overflow: auto;
    }

    .picker-label {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .color-sv {
      position: relative;
      flex: 1 1 6.5rem;
      width: 100%;
      height: 6.5rem;
      min-height: 4rem;
      max-height: 6.5rem;
      border: 1px solid var(--border);
      border-radius: 0.7rem;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      cursor: crosshair;
    }

    .color-sv-thumb {
      position: absolute;
      width: 0.9rem;
      height: 0.9rem;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .color-hue,
    .color-presets,
    .picker-btn,
    .picker-actions {
      flex-shrink: 0;
    }

    .color-hue {
      appearance: none;
      width: 100%;
      height: 0.75rem;
      margin: 0;
      padding: 0;
      border-radius: 999px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      cursor: pointer;
    }

    .color-hue:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .color-hue::-webkit-slider-thumb {
      appearance: none;
      width: 1.05rem;
      height: 1.05rem;
      border: 2px solid #fff;
      border-radius: 50%;
      background: transparent;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    }

    .color-hue::-moz-range-thumb {
      width: 1.05rem;
      height: 1.05rem;
      border: 2px solid #fff;
      border-radius: 50%;
      background: transparent;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    }

    .color-hue::-moz-range-track {
      height: 0.85rem;
      border: none;
      border-radius: 999px;
      background: transparent;
    }

    .color-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .color-preset {
      appearance: none;
      width: 1.85rem;
      height: 1.4rem;
      padding: 0;
      border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
      border-radius: 0.35rem;
      cursor: pointer;
    }

    .color-preset.selected {
      box-shadow:
        0 0 0 2px var(--surface),
        0 0 0 4px var(--accent);
    }

    .color-preset:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .picker-btn {
      appearance: none;
      width: 100%;
      min-width: 0;
      padding: 0.38rem 0.7rem;
      border-radius: 0.55rem;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
    }

    .picker-btn:hover:not(:disabled) {
      color: var(--text);
      border-color: color-mix(in srgb, var(--border) 70%, var(--text));
    }

    .picker-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .picker-actions {
      display: flex;
      gap: 0.45rem;
      width: 100%;
    }

    .picker-actions .picker-btn {
      width: auto;
      flex: 1;
    }

    .picker-btn-primary {
      color: #fff;
      background: var(--accent, #6c63ff);
      border-color: transparent;
    }

    .picker-btn-primary:hover:not(:disabled) {
      color: #fff;
      filter: brightness(1.06);
    }
  `,
})
export class HighlightColorPicker {
  readonly color = input<string | null>(null);
  /** Presets and custom colors already saved on elements. */
  readonly colors = input<readonly string[]>([]);
  readonly disabled = input(false);
  readonly saved = output<string | null>();
  readonly dismissed = output<void>();

  readonly draft = signal(DEFAULT_COLOR);
  readonly cleared = signal(true);
  /** True while the custom field, not an existing swatch, is the choice. */
  readonly customOpen = signal(false);
  readonly hue = signal(245);
  readonly sat = signal(0.61);
  readonly val = signal(1);

  constructor() {
    effect(() => {
      const color = sanitizeElementColor(this.color());
      const known = this.knownColors();
      if (color) {
        this.applyHex(color, false);
        this.customOpen.set(!known.has(color));
      } else {
        this.clearDraft();
        this.customOpen.set(false);
      }
    });
  }

  existingColors(): string[] {
    const colors: string[] = [];
    const seen = new Set<string>();
    const add = (value: unknown) => {
      const color = sanitizeElementColor(value);
      if (!color || seen.has(color)) return;
      seen.add(color);
      colors.push(color);
    };
    for (const color of ELEMENT_COLOR_PRESETS) add(color);
    for (const color of this.colors()) add(color);
    return colors;
  }

  shown(): string {
    return this.draft();
  }

  svBackground(): string {
    return `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(this.hue(), 1, 1)})`;
  }

  canReset(): boolean {
    return sanitizeElementColor(this.color()) != null || !this.cleared();
  }

  saveDisabled(): boolean {
    if (this.disabled()) return true;
    const saved = sanitizeElementColor(this.color());
    if (this.cleared()) return saved == null;
    return this.draft() === saved;
  }

  onHueInput(event: Event): void {
    if (this.disabled()) return;
    this.hue.set(Number((event.target as HTMLInputElement).value));
    this.applyHsv();
  }

  onSvPointer(event: PointerEvent): void {
    if (this.disabled()) return;
    const map = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') map.setPointerCapture(event.pointerId);
    if (!map.hasPointerCapture(event.pointerId) && event.type !== 'pointerdown') return;
    event.preventDefault();
    const rect = map.getBoundingClientRect();
    this.sat.set(clamp01((event.clientX - rect.left) / rect.width));
    this.val.set(clamp01(1 - (event.clientY - rect.top) / rect.height));
    this.applyHsv();
  }

  pickPreset(hex: string): void {
    if (this.disabled()) return;
    this.applyHex(hex, false);
    this.customOpen.set(false);
  }

  reset(): void {
    if (this.disabled() || !this.canReset()) return;
    this.clearDraft();
  }

  confirm(): void {
    if (this.saveDisabled()) return;
    if (this.cleared()) {
      this.saved.emit(null);
      return;
    }
    const draft = sanitizeElementColor(this.draft());
    if (!draft) return;
    this.saved.emit(draft);
  }

  private clearDraft(): void {
    const hsv = hexToHsv(DEFAULT_COLOR);
    this.draft.set(DEFAULT_COLOR);
    this.hue.set(hsv.h);
    this.sat.set(hsv.s);
    this.val.set(hsv.v);
    this.cleared.set(true);
    this.customOpen.set(false);
  }

  private applyHex(hex: string, cleared: boolean): void {
    const color = sanitizeElementColor(hex) ?? DEFAULT_COLOR;
    const hsv = hexToHsv(color);
    this.draft.set(color);
    this.hue.set(hsv.h);
    this.sat.set(hsv.s);
    this.val.set(hsv.v);
    this.cleared.set(cleared);
  }

  private applyHsv(): void {
    this.draft.set(hsvToHex(this.hue(), this.sat(), this.val()));
    this.cleared.set(false);
    this.customOpen.set(true);
  }

  private knownColors(): Set<string> {
    return new Set(this.existingColors());
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const color = sanitizeElementColor(hex) ?? DEFAULT_COLOR;
  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta + 6) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = chroma;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = chroma;
  } else if (hue < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
