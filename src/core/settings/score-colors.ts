const STORAGE_KEY = 'lingogem.score-colors.v2';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const SCORE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type ScoreStep = (typeof SCORE_STEPS)[number];

/** 1 is red, 5 is orange, 10 is green. The others are even steps between those. */
export const DEFAULT_SCORE_COLORS: Record<ScoreStep, string> = {
  1: '#ff5c7a',
  2: '#fb6a6c',
  3: '#f8785d',
  4: '#f4864f',
  5: '#f09440',
  6: '#ce9e43',
  7: '#ada946',
  8: '#8bb34a',
  9: '#6abe4d',
  10: '#48c850',
};

export type ScoreColorMap = Record<ScoreStep, string>;

function isScoreStep(value: number): value is ScoreStep {
  return SCORE_STEPS.some((step) => step === value);
}

function sanitizeScoreColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

function readStored(): Partial<ScoreColorMap> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const stored: Partial<ScoreColorMap> = {};
    for (const step of SCORE_STEPS) {
      const color = sanitizeScoreColor(record[String(step)]);
      if (color && color !== DEFAULT_SCORE_COLORS[step]) stored[step] = color;
    }
    return stored;
  } catch {
    return {};
  }
}

function writeStored(stored: Partial<ScoreColorMap>): void {
  if (typeof localStorage === 'undefined') return;
  const record: Record<string, string> = {};
  for (const step of SCORE_STEPS) {
    const color = stored[step];
    if (color) record[String(step)] = color;
  }
  if (Object.keys(record).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  else localStorage.removeItem(STORAGE_KEY);
  applyScoreColors();
}

/** Saved colors, with the default for any score that was not changed. */
export function readScoreColors(): ScoreColorMap {
  const stored = readStored();
  return {
    1: stored[1] ?? DEFAULT_SCORE_COLORS[1],
    2: stored[2] ?? DEFAULT_SCORE_COLORS[2],
    3: stored[3] ?? DEFAULT_SCORE_COLORS[3],
    4: stored[4] ?? DEFAULT_SCORE_COLORS[4],
    5: stored[5] ?? DEFAULT_SCORE_COLORS[5],
    6: stored[6] ?? DEFAULT_SCORE_COLORS[6],
    7: stored[7] ?? DEFAULT_SCORE_COLORS[7],
    8: stored[8] ?? DEFAULT_SCORE_COLORS[8],
    9: stored[9] ?? DEFAULT_SCORE_COLORS[9],
    10: stored[10] ?? DEFAULT_SCORE_COLORS[10],
  };
}

/** Saves one score. The default hex is stored as no override. Invalid values are ignored. */
export function writeScoreColor(step: ScoreStep, value: unknown): ScoreColorMap {
  const color = sanitizeScoreColor(value);
  if (!color || !isScoreStep(step)) return readScoreColors();
  const stored = readStored();
  if (color === DEFAULT_SCORE_COLORS[step]) delete stored[step];
  else stored[step] = color;
  writeStored(stored);
  return readScoreColors();
}

/** Clears every override and restores the ten defaults. */
export function resetScoreColors(): ScoreColorMap {
  writeStored({});
  return readScoreColors();
}

/** Paints saved overrides onto the document. Defaults stay on the stylesheet. */
export function applyScoreColors(): void {
  if (typeof document === 'undefined') return;
  const stored = readStored();
  const root = document.documentElement;
  for (const step of SCORE_STEPS) {
    const name = `--score-${step}`;
    const color = stored[step];
    if (color) root.style.setProperty(name, color);
    else root.style.removeProperty(name);
  }
}
