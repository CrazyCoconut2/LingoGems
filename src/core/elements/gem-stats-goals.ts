const KEY_PREFIX = 'lingogem.stats.goals.v1.';

const GOAL_KINDS = ['translation', 'example', 'definition', 'exercises'] as const;

export type DailyGoals = Record<(typeof GOAL_KINDS)[number], number | null>;

export function emptyDailyGoals(): DailyGoals {
  return { translation: null, example: null, definition: null, exercises: null };
}

export function readDailyGoals(language: string): DailyGoals {
  if (typeof localStorage === 'undefined') return emptyDailyGoals();
  const key = goalsKey(language);
  if (!key) return emptyDailyGoals();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyDailyGoals();
    const parsed = JSON.parse(raw) as unknown;
    const goals = normalizeGoals(parsed);
    if (hasLegacyGems(parsed)) writeDailyGoals(language, goals);
    return goals;
  } catch {
    return emptyDailyGoals();
  }
}

export function writeDailyGoals(language: string, goals: DailyGoals): void {
  if (typeof localStorage === 'undefined') return;
  const key = goalsKey(language);
  if (!key) return;
  const next = normalizeGoals(goals);
  try {
    if (goalsUnset(next)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(storedGoals(next)));
  } catch {
    // The in-memory goals still apply for this visit.
  }
}

export function readGoalInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

function goalsKey(language: string): string {
  const code = language.trim().toLowerCase();
  return code ? KEY_PREFIX + code : '';
}

function normalizeGoals(value: unknown): DailyGoals {
  const goals = emptyDailyGoals();
  if (!value || typeof value !== 'object') return goals;
  const source = value as Partial<Record<keyof DailyGoals, unknown>>;
  for (const kind of GOAL_KINDS) goals[kind] = positiveInteger(source[kind]);
  return goals;
}

function storedGoals(goals: DailyGoals): Partial<DailyGoals> {
  const stored: Partial<DailyGoals> = {};
  for (const kind of GOAL_KINDS) {
    const value = goals[kind];
    if (value != null) stored[kind] = value;
  }
  return stored;
}

function goalsUnset(goals: DailyGoals): boolean {
  return GOAL_KINDS.every((kind) => goals[kind] == null);
}

function hasLegacyGems(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'gems' in value;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
