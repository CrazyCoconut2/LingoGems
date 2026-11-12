import type { DayStats, ElementDayStats, GemCounts } from './gem-stats.worker';

const KEY_PREFIX = 'lingogem.stats.v1.';

export type StatsSnapshot = {
  computedAt: number;
  days: DayStats[];
};

export function readStatsSnapshot(language: string): StatsSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  const key = cacheKey(language);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '');
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStatsSnapshot(language: string, snapshot: StatsSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  const key = cacheKey(language);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // The in-memory snapshot still shows for this visit.
  }
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
    isCount(source.revealed)
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
