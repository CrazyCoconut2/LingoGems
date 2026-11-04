import { signal } from '@angular/core';

const STEP_GOAL_KEY = 'lingogem.step-goal.v1';

export const DEFAULT_STEP_GOAL = 3;
export const MIN_STEP_GOAL = 1;
export const MAX_STEP_GOAL = 99;

const revision = signal(0);

function languageCode(language: string): string {
  return language.trim().toLowerCase();
}

/** An integer from 1 to 99. Anything else is the default of 3. */
export function normalizeStepGoal(value: unknown): number {
  const goal = Math.round(Number(value));
  if (!Number.isInteger(goal) || goal < MIN_STEP_GOAL || goal > MAX_STEP_GOAL) return DEFAULT_STEP_GOAL;
  return goal;
}

function readMap(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STEP_GOAL_KEY) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, number> = {};
    for (const [code, value] of Object.entries(parsed)) {
      const key = languageCode(code);
      const goal = Math.round(Number(value));
      if (!key || !Number.isInteger(goal) || goal < MIN_STEP_GOAL || goal > MAX_STEP_GOAL) continue;
      if (goal !== DEFAULT_STEP_GOAL) map[key] = goal;
    }
    return map;
  } catch {
    return {};
  }
}

/** How many succeeded exercises each step needs. Missing values are 3. */
export function readStepGoal(language: string): number {
  revision();
  return storedStepGoal(language);
}

/** The saved goal, without watching later edits. */
export function currentStepGoal(language: string): number {
  return storedStepGoal(language);
}

function storedStepGoal(language: string): number {
  const code = languageCode(language);
  if (!code) return DEFAULT_STEP_GOAL;
  return readMap()[code] ?? DEFAULT_STEP_GOAL;
}

export function writeStepGoal(language: string, value: unknown): void {
  const code = languageCode(language);
  if (!code || typeof localStorage === 'undefined') return;
  const map = readMap();
  const goal = normalizeStepGoal(value);
  if (goal === DEFAULT_STEP_GOAL) delete map[code];
  else map[code] = goal;
  if (Object.keys(map).length) localStorage.setItem(STEP_GOAL_KEY, JSON.stringify(map));
  else localStorage.removeItem(STEP_GOAL_KEY);
  revision.update((current) => current + 1);
}
