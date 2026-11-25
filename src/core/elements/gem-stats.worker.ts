import {
  ELEMENTS_STORE,
  compileFormMatcher,
  displayTitle,
  idbRequest,
  isValidForm,
  openDatabase,
  phraseTokens,
  storedGem,
  type ElementGemCounts,
} from 'collection';

export type GemCounts = ElementGemCounts;

export type ElementDayStats = {
  id: string;
  title: string;
  gems: GemCounts;
  added: number;
  revealed: number;
  exercises: number;
};

export type DayStats = {
  day: string;
  gems: GemCounts;
  added: number;
  revealed: number;
  exercises: number;
  elements: ElementDayStats[];
};

/** A word from revealed phrases that is not an element title or a live form. */
export type MissingToken = {
  key: string;
  title: string;
  seen: number;
};

type CompileMessage = { type?: string; language?: unknown };

type MutableElement = ElementDayStats;

type MutableDay = {
  gems: GemCounts;
  added: number;
  revealed: number;
  exercises: number;
  elements: Map<string, MutableElement>;
};

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
    const result = tally(Array.isArray(records) ? records : [], language);
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
  language: string,
): { days: DayStats[]; missing: MissingToken[] } {
  const code = language.trim().toLowerCase();
  const days = new Map<string, MutableDay>();
  const phrases: string[] = [];
  const coverage = emptyCoverage();
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

    addCoverage(coverage, title, code);
    if (Array.isArray(source.definitions)) {
      for (const definition of source.definitions) {
        for (const form of definitionForms(definition)) addCoverage(coverage, form, code);
      }
    }

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
      if (entry.event === 'view' || entry.event === 'rework') continue;
      const day = bucket(days, entry.at);
      if (!day) continue;
      if (entry.event === 'reveal') {
        day.revealed += 1;
        elementOf(day, id, title).revealed += 1;
        const phrase = (entry as { phrase?: unknown }).phrase;
        if (typeof phrase === 'string' && phrase.trim()) phrases.push(phrase);
        continue;
      }
      if (entry.event === 'game' && isRecall(entry.game)) {
        day.exercises += 1;
        elementOf(day, id, title).exercises += 1;
        const gem = storedGem(entry);
        if (gem) {
          day.gems[gem] += 1;
          elementOf(day, id, title).gems[gem] += 1;
        }
      }
    }
  }

  const result: DayStats[] = [];
  for (const [day, stats] of days) {
    const elements = [...stats.elements.values()]
      .filter(hasActivity)
      .sort((left, right) => compareElements(left, right, code));
    if (!elements.length) continue;
    result.push({
      day,
      gems: stats.gems,
      added: stats.added,
      revealed: stats.revealed,
      exercises: stats.exercises,
      elements,
    });
  }
  result.sort((left, right) => (left.day < right.day ? 1 : left.day > right.day ? -1 : 0));
  return { days: result, missing: missingTokens(phrases, coverage, code) };
}

function bucket(days: Map<string, MutableDay>, at: unknown): MutableDay | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const key = dayKey(at);
  let day = days.get(key);
  if (!day) {
    day = {
      gems: emptyGems(),
      added: 0,
      revealed: 0,
      exercises: 0,
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
      gems: emptyGems(),
      added: 0,
      revealed: 0,
      exercises: 0,
    };
    day.elements.set(id, element);
  }
  return element;
}

function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function hasActivity(element: ElementDayStats): boolean {
  return (
    gemTotal(element.gems) > 0 || element.added + element.revealed > 0 || element.exercises > 0
  );
}

function compareElements(left: ElementDayStats, right: ElementDayStats, language: string): number {
  const gems = gemTotal(right.gems) - gemTotal(left.gems);
  if (gems) return gems;
  const exercises = right.exercises - left.exercises;
  if (exercises) return exercises;
  const activity = right.added + right.revealed - (left.added + left.revealed);
  if (activity) return activity;
  return left.title.localeCompare(right.title, language);
}

function emptyGems(): GemCounts {
  return { red: 0, orange: 0, green: 0 };
}

function gemTotal(gems: GemCounts): number {
  return gems.red + gems.orange + gems.green;
}

function isRecord(value: unknown): value is {
  event?: unknown;
  at?: unknown;
  game?: unknown;
  score?: unknown;
  extra?: unknown;
  answer?: unknown;
  gem?: unknown;
} {
  return !!value && typeof value === 'object';
}

function isRecall(game: unknown): game is 'definition' {
  return game === 'definition';
}

const PATTERN_MARK = /[*()|]/;

type Coverage = {
  exact: Set<string>;
  patterns: string[];
};

function emptyCoverage(): Coverage {
  return { exact: new Set(), patterns: [] };
}

function addCoverage(coverage: Coverage, raw: string, language: string): void {
  const text = foldApostrophes(raw.trim());
  if (!text || !isValidForm(text)) return;
  if (PATTERN_MARK.test(text)) {
    if (!coverage.patterns.includes(text)) coverage.patterns.push(text);
    return;
  }
  coverage.exact.add(tokenKey(text, language));
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

function missingTokens(
  phrases: readonly string[],
  coverage: Coverage,
  language: string,
): MissingToken[] {
  const counts = new Map<string, number>();
  for (const phrase of phrases) {
    for (const token of phraseTokens(phrase)) {
      const key = tokenKey(token, language);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const patterns: Array<(term: string) => boolean> = [];
  for (const form of coverage.patterns) {
    const matcher = compileFormMatcher(form);
    if (matcher) patterns.push(matcher);
  }
  const missing: MissingToken[] = [];
  for (const [key, seen] of counts) {
    if (seen <= 0 || coverage.exact.has(key) || patterns.some((matcher) => matcher(key))) continue;
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
