import {
  ELEMENTS_STORE,
  TRANSLATIONS_STORE,
  compileFormMatcher,
  definitionCoverage,
  displayTitle,
  idbRequest,
  isValidForm,
  openDatabase,
  phraseTokens,
} from 'collection';

export type ElementDayStats = {
  id: string;
  title: string;
  added: number;
  revealed: number;
  exercises: number;
  seen: number;
  /** During-day mean minus the mean of earlier days. Null when nothing was scored before that day. */
  differential: number | null;
};

export type DayStats = {
  day: string;
  added: number;
  revealed: number;
  exercises: number;
  seen: number;
  /** Distinct phrases unveiled that day. A phrase opened again the same day counts once. */
  translated: number;
  /** Sum of the element differentials that could be compared with an earlier mean. */
  differential: number;
  elements: ElementDayStats[];
};

/** A word from an unveiled translation that is not an element title or a live form. */
export type MissingToken = {
  key: string;
  title: string;
  seen: number;
};

type CompileMessage = { type?: string; language?: unknown };

type MutableElement = ElementDayStats;

type MutableDay = {
  added: number;
  revealed: number;
  exercises: number;
  seen: number;
  phrases: Set<string>;
  elements: Map<string, MutableElement>;
};

type CoverageAttempt = { at: number; coverage: number };

addEventListener('message', (event: MessageEvent<CompileMessage>) => {
  if (event.data?.type !== 'compile') return;
  const language = typeof event.data.language === 'string' ? event.data.language : '';
  void compile(language);
});

async function compile(language: string): Promise<void> {
  try {
    const db = await openDatabase();
    const records = await idbRequest(
      db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).getAll(),
    );
    const translations = await idbRequest(
      db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE).getAll(),
    );
    const result = tally(
      Array.isArray(records) ? records : [],
      Array.isArray(translations) ? translations : [],
      language,
    );
    postMessage({
      ok: true,
      days: result.days,
      missing: result.missing,
    });
  } catch {
    postMessage({ ok: false });
  }
}

function tally(
  records: unknown[],
  translations: unknown[],
  language: string,
): { days: DayStats[]; missing: MissingToken[] } {
  const code = language.trim().toLowerCase();
  const days = new Map<string, MutableDay>();
  const attempts = new Map<string, CoverageAttempt[]>();
  const exactIndex = new Map<string, ElementClaim[]>();
  const patterned: ElementClaim[] = [];
  if (!code) return { days: [], missing: [] };

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const source = record as {
      language?: unknown;
      id?: unknown;
      title?: unknown;
      createdAt?: unknown;
      definitions?: unknown;
      log?: unknown;
    };
    if (
      String(source.language ?? '')
        .trim()
        .toLowerCase() !== code
    )
      continue;
    const id = String(source.id ?? '').trim();
    const title = String(source.title ?? '').trim();
    if (!id || !title) continue;

    const claim: ElementClaim = { id, title, exact: new Set(), patterns: [] };
    claimSurface(claim, title, code);
    if (Array.isArray(source.definitions)) {
      for (const definition of source.definitions) {
        for (const form of definitionForms(definition)) claimSurface(claim, form, code);
      }
    }
    indexClaim(claim, exactIndex, patterned);

    const createdAt = source.createdAt;
    if (typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0) {
      const created = bucket(days, createdAt);
      if (created) {
        created.added += 1;
        elementOf(created, id, title).added = 1;
      }
    }

    const entries = Array.isArray(source.log) ? source.log : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (
        entry.event === 'view' ||
        entry.event === 'rework' ||
        entry.event === 'reveal' ||
        entry.event === 'removed' ||
        entry.event === 'restored'
      ) {
        continue;
      }
      const day = bucket(days, entry.at);
      if (!day) continue;
      if (entry.event === 'seen') {
        day.seen += 1;
        elementOf(day, id, title).seen += 1;
        continue;
      }
      if (entry.event === 'game' && isRecall(entry.game)) {
        const answer = typeof entry.answer === 'string' ? entry.answer.trim() : '';
        if (answer) {
          day.exercises += 1;
          elementOf(day, id, title).exercises += 1;
        }
        const score = coverageOf(entry);
        if (score != null && typeof entry.at === 'number') {
          const prior = attempts.get(id);
          if (prior) prior.push({ at: entry.at, coverage: score });
          else attempts.set(id, [{ at: entry.at, coverage: score }]);
        }
      }
    }
  }

  const unmatched = tallyUnveils(translations, code, days, exactIndex, patterned);
  applyDifferentials(days, attempts);

  const result: DayStats[] = [];
  for (const [day, stats] of days) {
    const elements = [...stats.elements.values()]
      .filter(hasActivity)
      .sort((left, right) => compareElements(left, right, code));
    const translated = stats.phrases.size;
    if (!elements.length && translated === 0) continue;
    result.push({
      day,
      added: stats.added,
      revealed: stats.revealed,
      exercises: stats.exercises,
      seen: stats.seen,
      translated,
      differential: dayDifferential(elements),
      elements,
    });
  }
  result.sort((left, right) => (left.day < right.day ? 1 : left.day > right.day ? -1 : 0));
  return { days: result, missing: missingTokens(unmatched, code) };
}

function bucket(days: Map<string, MutableDay>, at: unknown): MutableDay | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const key = dayKey(at);
  let day = days.get(key);
  if (!day) {
    day = {
      added: 0,
      revealed: 0,
      exercises: 0,
      seen: 0,
      phrases: new Set(),
      elements: new Map(),
    };
    days.set(key, day);
  }
  return day;
}

function elementOf(day: MutableDay, id: string, title: string): MutableElement {
  let element = day.elements.get(id);
  if (!element) {
    element = {
      id,
      title,
      added: 0,
      revealed: 0,
      exercises: 0,
      seen: 0,
      differential: null,
    };
    day.elements.set(id, element);
  }
  return element;
}

/** During-day mean minus the mean of every earlier day. The first scored day has no earlier mean. */
function applyDifferentials(
  days: Map<string, MutableDay>,
  attempts: Map<string, CoverageAttempt[]>,
): void {
  for (const [id, scores] of attempts) {
    scores.sort((left, right) => left.at - right.at);
    let priorSum = 0;
    let priorCount = 0;
    let index = 0;
    while (index < scores.length) {
      const key = dayKey(scores[index].at);
      let daySum = 0;
      let dayCount = 0;
      while (index < scores.length && dayKey(scores[index].at) === key) {
        daySum += scores[index].coverage;
        dayCount += 1;
        index += 1;
      }
      if (priorCount > 0) {
        const element = days.get(key)?.elements.get(id);
        if (element) element.differential = daySum / dayCount - priorSum / priorCount;
      }
      priorSum += daySum;
      priorCount += dayCount;
    }
  }
}

function dayDifferential(elements: readonly ElementDayStats[]): number {
  let total = 0;
  for (const element of elements) {
    if (element.differential != null) total += element.differential;
  }
  return total;
}

function coverageOf(entry: { score?: unknown; extra?: unknown }): number | null {
  const score = entry.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return definitionCoverage({ score, extra: entry.extra === true });
}

function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function hasActivity(element: ElementDayStats): boolean {
  return element.added + element.revealed + element.seen > 0 || element.exercises > 0;
}

function compareElements(left: ElementDayStats, right: ElementDayStats, language: string): number {
  const exercises = right.exercises - left.exercises;
  if (exercises) return exercises;
  const activity =
    right.added + right.revealed + right.seen - (left.added + left.revealed + left.seen);
  if (activity) return activity;
  return left.title.localeCompare(right.title, language);
}

function isRecord(value: unknown): value is {
  event?: unknown;
  at?: unknown;
  game?: unknown;
  score?: unknown;
  extra?: unknown;
  answer?: unknown;
} {
  return !!value && typeof value === 'object';
}

function isRecall(game: unknown): game is 'definition' {
  return game === 'definition';
}

const PATTERN_MARK = /[*()|]/;

/** Title and live forms that a translated word can belong to. */
type ElementClaim = {
  id: string;
  title: string;
  exact: Set<string>;
  patterns: Array<(term: string) => boolean>;
};

function claimSurface(claim: ElementClaim, raw: string, language: string): void {
  const text = foldApostrophes(raw.trim());
  if (!text || !isValidForm(text)) return;
  if (PATTERN_MARK.test(text)) {
    const matcher = compileFormMatcher(text);
    if (matcher) claim.patterns.push(matcher);
    return;
  }
  claim.exact.add(tokenKey(text, language));
}

function indexClaim(
  claim: ElementClaim,
  exactIndex: Map<string, ElementClaim[]>,
  patterned: ElementClaim[],
): void {
  for (const key of claim.exact) {
    const owners = exactIndex.get(key);
    if (owners) owners.push(claim);
    else exactIndex.set(key, [claim]);
  }
  if (claim.patterns.length) patterned.push(claim);
}

function claimsFor(
  key: string,
  exactIndex: Map<string, ElementClaim[]>,
  patterned: readonly ElementClaim[],
): ElementClaim[] {
  const found: ElementClaim[] = [];
  const seen = new Set<ElementClaim>();
  for (const claim of exactIndex.get(key) ?? []) {
    if (seen.has(claim)) continue;
    seen.add(claim);
    found.push(claim);
  }
  for (const claim of patterned) {
    if (seen.has(claim) || !claim.patterns.some((matcher) => matcher(key))) continue;
    seen.add(claim);
    found.push(claim);
  }
  return found;
}

/**
 * Each unveil date counts every word in the phrase. A stored wording with no date does not.
 * The phrase itself counts once for each day it was unveiled.
 */
function tallyUnveils(
  translations: readonly unknown[],
  language: string,
  days: Map<string, MutableDay>,
  exactIndex: Map<string, ElementClaim[]>,
  patterned: readonly ElementClaim[],
): Map<string, number> {
  const missing = new Map<string, number>();
  for (const record of translations) {
    const phrase = translationPhrase(record, language);
    if (!phrase) continue;
    const tokens = phraseTokens(phrase.phrase);
    const counted = new Set<string>();
    for (const date of phrase.dates) {
      const at = Date.parse(date);
      if (!Number.isFinite(at)) continue;
      const dayName = dayKey(at);
      if (!counted.has(dayName)) {
        counted.add(dayName);
        const day = bucket(days, at);
        if (day) day.phrases.add(phrase.phrase);
      }
      if (!tokens.length) continue;
      for (const token of tokens) {
        const key = tokenKey(token, language);
        if (!key) continue;
        const matched = claimsFor(key, exactIndex, patterned);
        if (!matched.length) {
          missing.set(key, (missing.get(key) ?? 0) + 1);
          continue;
        }
        const day = bucket(days, at);
        if (!day) continue;
        for (const claim of matched) {
          day.revealed += 1;
          elementOf(day, claim.id, claim.title).revealed += 1;
        }
      }
    }
  }
  return missing;
}

function translationPhrase(
  value: unknown,
  language: string,
): { phrase: string; dates: string[] } | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { source?: unknown; phrase?: unknown; dates?: unknown };
  if (
    String(source.source ?? '')
      .trim()
      .toLowerCase() !== language
  )
    return null;
  if (typeof source.phrase !== 'string' || !Array.isArray(source.dates)) return null;
  const dates = source.dates.filter((item): item is string => typeof item === 'string' && !!item);
  return dates.length ? { phrase: source.phrase, dates } : null;
}

function definitionForms(definition: unknown): string[] {
  if (!definition || typeof definition !== 'object') return [];
  const forms = (definition as { forms?: unknown }).forms;
  if (!Array.isArray(forms)) return [];
  const texts: string[] = [];
  for (const form of forms) {
    if (!form || typeof form !== 'object') continue;
    const text = (form as { text?: unknown }).text;
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (trimmed) texts.push(trimmed);
  }
  return texts;
}

function missingTokens(counts: ReadonlyMap<string, number>, language: string): MissingToken[] {
  const missing: MissingToken[] = [];
  for (const [key, seen] of counts) {
    if (seen <= 0) continue;
    const title = displayTitle(key, language);
    if (!title) continue;
    missing.push({ key, title, seen });
  }
  missing.sort(
    (left, right) => right.seen - left.seen || left.title.localeCompare(right.title, language),
  );
  return missing;
}

function tokenKey(token: string, language: string): string {
  return foldApostrophes(token).toLocaleLowerCase(language);
}

function foldApostrophes(value: string): string {
  return value.replace(/[\u0027\u2019]/g, "'");
}
