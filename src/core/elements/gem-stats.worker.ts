import { ELEMENTS_STORE, idbRequest, openDatabase } from 'collection';

export type GemCounts = {
  translation: number;
  example: number;
  definition: number;
};

export type ElementDayStats = {
  id: string;
  title: string;
  gems: GemCounts;
  opened: number;
  reworked: number;
  revealed: number;
  exercises: number;
};

export type DayStats = {
  day: string;
  gems: GemCounts;
  opened: number;
  reworked: number;
  revealed: number;
  exercises: number;
  elements: ElementDayStats[];
};

type GemGame = keyof GemCounts;

type CompileMessage = { type?: string; language?: unknown };

type MutableElement = ElementDayStats;

type MutableDay = {
  gems: GemCounts;
  opened: number;
  reworked: number;
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
    postMessage({
      ok: true,
      days: tally(Array.isArray(records) ? records : [], language),
    });
  } catch {
    postMessage({ ok: false });
  }
}

function tally(records: unknown[], language: string): DayStats[] {
  const code = language.trim().toLowerCase();
  const days = new Map<string, MutableDay>();
  if (!code) return [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const source = record as {
      deletedAt?: unknown;
      language?: unknown;
      id?: unknown;
      title?: unknown;
      log?: unknown;
      definitions?: unknown;
    };
    if (source.deletedAt != null) continue;
    if (
      String(source.language ?? '')
        .trim()
        .toLowerCase() !== code
    )
      continue;
    const id = String(source.id ?? '').trim();
    const title = String(source.title ?? '').trim();
    if (!id || !title) continue;

    if (Array.isArray(source.log)) {
      for (const entry of source.log) {
        if (!isRecord(entry) || entry.event !== 'click') continue;
        const day = bucket(days, entry.at);
        if (!day) continue;
        day.opened += 1;
        elementOf(day, id, title).opened += 1;
      }
    }

    if (!Array.isArray(source.definitions)) continue;
    for (const definition of source.definitions) {
      if (!isRecord(definition) || !Array.isArray(definition.log)) continue;
      for (const entry of definition.log) {
        if (!isRecord(entry)) continue;
        const day = bucket(days, entry.at);
        if (!day) continue;
        if (entry.event === 'rework') {
          day.reworked += 1;
          elementOf(day, id, title).reworked += 1;
          continue;
        }
        if (entry.event === 'reveal') {
          day.revealed += 1;
          elementOf(day, id, title).revealed += 1;
          continue;
        }
        if (entry.event === 'game' && isGame(entry.game)) {
          day.exercises += 1;
          elementOf(day, id, title).exercises += 1;
          const gems = entry.gems;
          if (typeof gems === 'number' && Number.isFinite(gems) && gems > 0) {
            day.gems[entry.game] += gems;
            elementOf(day, id, title).gems[entry.game] += gems;
          }
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
      opened: stats.opened,
      reworked: stats.reworked,
      revealed: stats.revealed,
      exercises: stats.exercises,
      elements,
    });
  }
  result.sort((left, right) => (left.day < right.day ? 1 : left.day > right.day ? -1 : 0));
  return result;
}

function bucket(days: Map<string, MutableDay>, at: unknown): MutableDay | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const key = dayKey(at);
  let day = days.get(key);
  if (!day) {
    day = {
      gems: { translation: 0, example: 0, definition: 0 },
      opened: 0,
      reworked: 0,
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
      gems: { translation: 0, example: 0, definition: 0 },
      opened: 0,
      reworked: 0,
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
    gemTotal(element.gems) > 0 ||
    element.opened + element.reworked + element.revealed > 0 ||
    element.exercises > 0
  );
}

function compareElements(left: ElementDayStats, right: ElementDayStats, language: string): number {
  const gems = gemTotal(right.gems) - gemTotal(left.gems);
  if (gems) return gems;
  const exercises = right.exercises - left.exercises;
  if (exercises) return exercises;
  const activity =
    right.opened + right.reworked + right.revealed - (left.opened + left.reworked + left.revealed);
  if (activity) return activity;
  return left.title.localeCompare(right.title, language);
}

function gemTotal(gems: GemCounts): number {
  return gems.translation + gems.example + gems.definition;
}

function isRecord(value: unknown): value is {
  event?: unknown;
  at?: unknown;
  game?: unknown;
  gems?: unknown;
  log?: unknown;
} {
  return !!value && typeof value === 'object';
}

function isGame(game: unknown): game is GemGame {
  return game === 'translation' || game === 'example' || game === 'definition';
}
