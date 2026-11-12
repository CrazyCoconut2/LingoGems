import { ELEMENTS_STORE, idbRequest, openDatabase } from 'collection';

export type GemStats = {
  translation: number;
  example: number;
  definition: number;
};

type GemGame = keyof GemStats;

addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type !== 'compile') return;
  void compile();
});

async function compile(): Promise<void> {
  try {
    const db = await openDatabase();
    const records = await idbRequest(
      db.transaction(ELEMENTS_STORE, 'readonly').objectStore(ELEMENTS_STORE).getAll(),
    );
    postMessage({ ok: true, stats: tally(Array.isArray(records) ? records : []) });
  } catch {
    postMessage({ ok: false });
  }
}

function tally(records: unknown[]): GemStats {
  const stats: GemStats = { translation: 0, example: 0, definition: 0 };
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const source = record as { deletedAt?: unknown; definitions?: unknown };
    if (source.deletedAt != null) continue;
    if (!Array.isArray(source.definitions)) continue;
    for (const definition of source.definitions) {
      if (!definition || typeof definition !== 'object') continue;
      const log = (definition as { log?: unknown }).log;
      if (!Array.isArray(log)) continue;
      for (const entry of log) {
        if (!entry || typeof entry !== 'object') continue;
        const game = (entry as { game?: unknown }).game;
        const gems = (entry as { gems?: unknown }).gems;
        if (!isGame(game) || typeof gems !== 'number' || !Number.isFinite(gems) || gems <= 0) {
          continue;
        }
        stats[game] += gems;
      }
    }
  }
  return stats;
}

function isGame(game: unknown): game is GemGame {
  return game === 'translation' || game === 'example' || game === 'definition';
}
