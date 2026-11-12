import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  pendingStatsLanguages,
  readStatsView,
  writeStatsError,
  writeStatsPending,
  writeStatsSnapshot,
  type StatsSnapshot,
  type StatsView,
} from './gem-stats-cache';
import type { DayStats } from './gem-stats.worker';

type StatsMessage = { ok?: boolean; days?: DayStats[] };

const DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class GemStatsJob {
  private readonly zone = inject(NgZone);
  private readonly tick = signal(0);
  private readonly memory = new Map<string, StatsView>();
  private readonly generation = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queued = new Map<string, number>();
  private worker: Worker | null = null;
  private running: { language: string; generation: number } | null = null;
  private request = 0;

  view(language: string): StatsView {
    this.tick();
    const code = normalize(language);
    if (!code) return { phase: 'empty', snapshot: null };
    let cached = this.memory.get(code);
    if (!cached) {
      cached = readStatsView(code);
      this.memory.set(code, cached);
    }
    return cached;
  }

  /** Mark this language stale and compile again after a short quiet period. */
  invalidate(language: string): void {
    const code = normalize(language);
    if (!code) return;
    const generation = (this.generation.get(code) ?? 0) + 1;
    this.generation.set(code, generation);
    writeStatsPending(code);
    this.remember(code, { phase: 'pending', snapshot: null });
    this.queued.delete(code);
    if (this.running?.language === code) this.retireWorker();
    this.arm(code, generation);
    if (!this.running) this.pump();
  }

  /** Compile when this language has no snapshot yet, or a pending run was dropped. */
  ensure(language: string): void {
    const code = normalize(language);
    if (!code) return;
    const phase = this.view(code).phase;
    if (phase === 'ready' || phase === 'error') return;
    if (phase === 'empty') {
      this.invalidate(code);
      return;
    }
    if (this.isActive(code)) return;
    this.compile(code, this.generation.get(code) ?? 0);
  }

  /** Pick up compiles that were still pending when the page last closed. */
  resumePending(): void {
    for (const language of pendingStatsLanguages()) {
      if (this.isActive(language)) continue;
      this.compile(language, this.generation.get(language) ?? 0);
    }
  }

  private arm(language: string, generation: number): void {
    const existing = this.timers.get(language);
    if (existing != null) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(language);
      this.compile(language, generation);
    }, DEBOUNCE_MS);
    this.timers.set(language, timer);
  }

  private compile(language: string, generation: number): void {
    if ((this.generation.get(language) ?? 0) !== generation) return;
    if (this.running) {
      this.queued.set(language, generation);
      return;
    }
    this.start(language, generation);
  }

  private start(language: string, generation: number): void {
    if ((this.generation.get(language) ?? 0) !== generation) {
      this.pump();
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gem-stats.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.fail(language, generation);
      return;
    }
    const request = this.request;
    this.worker = worker;
    this.running = { language, generation };
    worker.onmessage = (event: MessageEvent<StatsMessage>) => {
      this.zone.run(() => {
        if (request !== this.request) return;
        this.finish(language, generation, event.data);
      });
    };
    worker.onerror = () => {
      this.zone.run(() => {
        if (request !== this.request) return;
        this.fail(language, generation);
      });
    };
    worker.postMessage({ type: 'compile', language });
  }

  private finish(language: string, generation: number, message: StatsMessage | null): void {
    this.retireWorker();
    if ((this.generation.get(language) ?? 0) !== generation) {
      this.pump();
      return;
    }
    if (!message?.ok || !Array.isArray(message.days)) {
      this.markError(language);
      this.pump();
      return;
    }
    const snapshot: StatsSnapshot = { computedAt: Date.now(), days: message.days };
    writeStatsSnapshot(language, snapshot);
    this.remember(language, { phase: 'ready', snapshot });
    this.pump();
  }

  private fail(language: string, generation: number): void {
    this.retireWorker();
    if ((this.generation.get(language) ?? 0) !== generation) {
      this.pump();
      return;
    }
    this.markError(language);
    this.pump();
  }

  private markError(language: string): void {
    writeStatsError(language);
    this.remember(language, { phase: 'error', snapshot: null });
  }

  private pump(): void {
    if (this.running) return;
    for (const [language, generation] of this.queued) {
      this.queued.delete(language);
      if ((this.generation.get(language) ?? 0) !== generation) continue;
      this.start(language, generation);
      return;
    }
  }

  private isActive(language: string): boolean {
    return (
      this.timers.has(language) || this.running?.language === language || this.queued.has(language)
    );
  }

  private remember(language: string, view: StatsView): void {
    this.memory.set(language, view);
    this.publish();
  }

  private publish(): void {
    const bump = () => this.tick.update((value) => value + 1);
    if (NgZone.isInAngularZone()) bump();
    else this.zone.run(bump);
  }

  private retireWorker(): void {
    this.request += 1;
    this.worker?.terminate();
    this.worker = null;
    this.running = null;
  }
}

function normalize(language: string): string {
  return language.trim().toLowerCase();
}
