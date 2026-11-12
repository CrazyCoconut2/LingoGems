import type { DayStats, ElementDayStats, GemCounts } from './gem-stats.worker';

const KEY_PREFIX = 'lingogem.stats.v2.';

export type StatsPhase = 'empty' | 'pending' | 'ready' | 'error';

export type StatsSnapshot = {
  computedAt: number;
  days: DayStats[];
};

export type StatsView = {
  phase: StatsPhase;
  snapshot: StatsSnapshot | null;
};

const EMPTY_VIEW: StatsView = { phase: 'empty', snapshot: null };

export function readStatsSnapshot(language: string): StatsSnapshot | null {
  const view = readStatsView(language);
  return view.phase === 'ready' ? view.snapshot : null;
}

export function readStatsView(language: string): StatsView {
  const record = readRecord(language);
  if (!record) return EMPTY_VIEW;
  if (record.status === 'pending') return { phase: 'pending', snapshot: null };
  if (record.status === 'error') return { phase: 'error', snapshot: null };
  return { phase: 'ready', snapshot: { computedAt: record.computedAt, days: record.days } };
}

export function writeStatsSnapshot(language: string, snapshot: StatsSnapshot): void {
  writeRecord(language, { status: 'ready', ...snapshot });
}

export function writeStatsPending(language: string): void {
  writeRecord(language, { status: 'pending' });
}

export function writeStatsError(language: string): void {
  writeRecord(language, { status: 'error' });
}

/** Languages left pending when a compile was still running. */
export function pendingStatsLanguages(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const languages: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const language = key.slice(KEY_PREFIX.length);
      if (readStatsView(language).phase === 'pending') languages.push(language);
    }
  } catch {
    return languages;
  }
  return languages;
}

/** Removes compiled stats only. Goals and other settings stay. */
export function clearStatsCache(): void {
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // The in-memory view is already cleared.
  }
}

type StatsRecord =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'ready'; computedAt: number; days: DayStats[] };

function readRecord(language: string): StatsRecord | null {
  if (typeof localStorage === 'undefined') return null;
  const key = cacheKey(language);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '');
    return recordOf(parsed);
  } catch {
    return null;
  }
}

function writeRecord(language: string, record: StatsRecord): void {
  if (typeof localStorage === 'undefined') return;
  const key = cacheKey(language);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // The in-memory view still shows for this visit.
  }
}

function recordOf(value: unknown): StatsRecord | null {
  if (!value || typeof value !== 'object') return null;
  const status = (value as { status?: unknown }).status;
  if (status === 'pending') return { status: 'pending' };
  if (status === 'error') return { status: 'error' };
  if (status !== undefined && status !== 'ready') return null;
  if (!isSnapshot(value)) return null;
  return { status: 'ready', computedAt: value.computedAt, days: value.days };
}

function cacheKey(language: string): string {
  const code = language.trim().toLowerCase();
  return code ? KEY_PREFIX + code : '';
}

function isSnapshot(value: unknown): value is StatsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const source = value as { computedAt?: unknown; days?: unknown };
  return isCount(source.computedAt) && Array.isArray(source.days) && source.days.every(isDay);
}

function isDay(value: unknown): value is DayStats {
  if (!value || typeof value !== 'object') return false;
  const source = value as DayStats;
  return (
    typeof source.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.day) &&
    isGemCounts(source.gems) &&
    isCount(source.opened) &&
    isCount(source.reworked) &&
    isCount(source.revealed) &&
    isDelta(source.comfort) &&
    Array.isArray(source.elements) &&
    source.elements.every(isElementDay)
  );
}

function isElementDay(value: unknown): value is ElementDayStats {
  if (!value || typeof value !== 'object') return false;
  const source = value as ElementDayStats;
  return (
    typeof source.id === 'string' &&
    source.id.trim().length > 0 &&
    typeof source.title === 'string' &&
    source.title.trim().length > 0 &&
    isGemCounts(source.gems) &&
    isCount(source.opened) &&
    isCount(source.reworked) &&
    isCount(source.revealed) &&
    isDelta(source.comfort)
  );
}

function isGemCounts(value: unknown): value is GemCounts {
  if (!value || typeof value !== 'object') return false;
  const source = value as GemCounts;
  return isCount(source.translation) && isCount(source.example) && isCount(source.definition);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isDelta(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
