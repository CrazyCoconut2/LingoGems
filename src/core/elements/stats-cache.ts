import type { DayStats, ElementDayStats, MissingToken } from './stats.worker';

const KEY_PREFIX = 'lingogem.stats.v22.';
const STALE_STATS_ROOT = 'lingogem.stats.v';

export type StatsPhase = 'empty' | 'pending' | 'ready' | 'error';

export type StatsSnapshot = {
  computedAt: number;
  days: DayStats[];
  missing: MissingToken[];
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
  return {
    phase: 'ready',
    snapshot: { computedAt: record.computedAt, days: record.days, missing: record.missing },
  };
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

/** Languages that already have a compiled snapshot, including a run left pending. */
export function cachedStatsLanguages(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const languages: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const language = key.slice(KEY_PREFIX.length);
      if (language) languages.push(language);
    }
  } catch {
    return languages;
  }
  return languages;
}

/** Languages left pending when a compile was still running. */
export function pendingStatsLanguages(): string[] {
  return cachedStatsLanguages().filter((language) => readStatsView(language).phase === 'pending');
}

/** Removes compiled stats only. Other settings stay. */
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
  | { status: 'ready'; computedAt: number; days: DayStats[]; missing: MissingToken[] };

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
  return {
    status: 'ready',
    computedAt: value.computedAt,
    days: value.days,
    missing: value.missing,
  };
}

/** Drops compiled snapshots from earlier stats formats, and leftover daily-goal records. */
function dropStaleStatsKeys(): void {
  if (typeof localStorage === 'undefined') return;
  const stale: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const staleStats = key.startsWith(STALE_STATS_ROOT) && !key.startsWith(KEY_PREFIX);
      if (staleStats || key.startsWith('lingogem.stats.goals.')) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // The current snapshot still loads.
  }
}

function cacheKey(language: string): string {
  const code = language.trim().toLowerCase();
  return code ? KEY_PREFIX + code : '';
}

function isSnapshot(value: unknown): value is StatsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const source = value as { computedAt?: unknown; days?: unknown; missing?: unknown };
  return (
    isCount(source.computedAt) &&
    Array.isArray(source.days) &&
    source.days.every(isDay) &&
    Array.isArray(source.missing) &&
    source.missing.every(isMissingToken)
  );
}

function isDay(value: unknown): value is DayStats {
  if (!value || typeof value !== 'object') return false;
  const source = value as DayStats;
  return (
    typeof source.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.day) &&
    isCount(source.added) &&
    isCount(source.revealed) &&
    isCount(source.exercises) &&
    isCount(source.seen) &&
    isCount(source.translated) &&
    isSigned(source.differential) &&
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
    isCount(source.added) &&
    isCount(source.removed) &&
    isCount(source.revealed) &&
    isCount(source.exercises) &&
    isCount(source.seen) &&
    isOptionalSigned(source.differential)
  );
}

function isMissingToken(value: unknown): value is MissingToken {
  if (!value || typeof value !== 'object') return false;
  const source = value as MissingToken;
  return (
    typeof source.key === 'string' &&
    source.key.trim().length > 0 &&
    typeof source.title === 'string' &&
    source.title.trim().length > 0 &&
    isCount(source.seen) &&
    source.seen > 0
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSigned(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalSigned(value: unknown): value is number | null {
  return value === null || isSigned(value);
}

dropStaleStatsKeys();
