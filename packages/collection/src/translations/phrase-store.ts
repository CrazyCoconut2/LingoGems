import { TRANSLATIONS_STORE, idbRequest, openDatabase } from '../database';

/** Support-language wording of one phrase, and each time it was unveiled. */
export type PhraseTranslation = {
  text: string;
  dates: string[];
};

/** One stored phrase translation, keyed by learning language, support language, and phrase. */
export type StoredPhraseTranslation = PhraseTranslation & {
  source: string;
  target: string;
  phrase: string;
};

type PhraseKey = {
  source: string;
  target: string;
  phrase: string;
};

const memory = new Map<string, Map<string, Map<string, PhraseTranslation>>>();

let chain: Promise<void> = Promise.resolve();
let loading: Promise<void> | null = null;
let phraseTranslationListener: ((language: string) => void) | null = null;

/** Notified with the learning language after a translation write commits. */
export function setPhraseTranslationListener(listener: ((language: string) => void) | null): void {
  phraseTranslationListener = listener;
}

/** Runs after any in-flight translation write, so a replace cannot land under a stale put. */
export function withPhraseTranslationWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Reads the translations store into memory. */
export function loadPhraseTranslations(): Promise<void> {
  if (!loading) {
    loading = withPhraseTranslationWrite(hydrate).catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** The stored translation for this phrase, or null when this language pair has none. */
export function readPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
): PhraseTranslation | null {
  const key = phraseKey(sourceLang, targetLang, phrase);
  if (!key) return null;
  const found = readMemory(key);
  if (!found) return null;
  return { text: found.text, dates: [...found.dates] };
}

/**
 * Replace the stored translation for this phrase.
 * Unveil dates stay. Empty text removes the entry. This is not an unveil.
 */
export function replacePhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text: string,
): string {
  const key = phraseKey(sourceLang, targetLang, phrase);
  if (!key) return '';
  const body = text.trim();
  if (!body) {
    deleteMemory(key);
    persist(key);
    return '';
  }
  const current = readMemory(key);
  writeMemory(key, { text: body, dates: current?.dates ?? [] });
  persist(key);
  return body;
}

/** Store the translation text. An existing wording is kept, and unveil dates stay as they are. */
export function recordPhraseTranslation(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text: string,
): string {
  const key = phraseKey(sourceLang, targetLang, phrase);
  const body = text.trim();
  if (!key || !body) throw new Error('translate_failed');
  const current = readMemory(key);
  const next = { text: current?.text || body, dates: current?.dates ?? [] };
  writeMemory(key, next);
  persist(key);
  return next.text;
}

/** One click that revealed a translation which was already stored. */
export function notePhraseUnveil(
  sourceLang: string,
  targetLang: string,
  phrase: string,
  text = '',
): void {
  const key = phraseKey(sourceLang, targetLang, phrase);
  if (!key) return;
  const current = readMemory(key);
  const stored = (current?.text || text).trim();
  if (!stored) return;
  writeMemory(key, {
    text: stored,
    dates: [...(current?.dates ?? []), new Date().toISOString()],
  });
  persist(key);
}

/** Phrase translations in memory, after in-flight store writes finish. */
export async function readAllPhraseTranslations(): Promise<StoredPhraseTranslation[]> {
  await withPhraseTranslationWrite(async () => undefined);
  return snapshot();
}

/** Replaces the translations store and the in-memory mirror. */
export function replacePhraseTranslations(translations: readonly unknown[]): Promise<void> {
  const records = normalizeStoredPhraseTranslations(translations);
  return withPhraseTranslationWrite(async () => {
    if (typeof indexedDB !== 'undefined') {
      const db = await openDatabase();
      const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
      const done = transactionDone(tx);
      putRecords(tx, records);
      await done;
    }
    adoptPhraseTranslations(records);
  });
}

/** Keeps valid phrase translations, last record winning when the key is repeated. */
export function normalizeStoredPhraseTranslations(value: unknown): StoredPhraseTranslation[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, StoredPhraseTranslation>();
  for (const item of value) {
    const record = recordOf(item);
    if (record) byKey.set(recordKey(record), record);
  }
  return [...byKey.values()].sort(compareRecords);
}

/** Queues a full replacement on a transaction that already includes the translations store. */
export function stagePhraseTranslations(
  tx: IDBTransaction,
  translations: readonly unknown[],
): StoredPhraseTranslation[] {
  const records = normalizeStoredPhraseTranslations(translations);
  putRecords(tx, records);
  return records;
}

/** Points the in-memory mirror at these records. Call after the replacement transaction commits. */
export function adoptPhraseTranslations(records: readonly StoredPhraseTranslation[]): void {
  const sources = new Set(memory.keys());
  memory.clear();
  for (const record of records) {
    const key = phraseKey(record.source, record.target, record.phrase);
    if (!key) continue;
    writeMemory(key, { text: record.text, dates: record.dates });
    sources.add(key.source);
  }
  for (const source of sources) phraseTranslationListener?.(source);
}

async function hydrate(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  for (const record of await readDatabase()) rememberIfAbsent(record);
}

function persist(key: PhraseKey): void {
  void withPhraseTranslationWrite(() => flush(key)).catch(() => undefined);
}

async function flush(key: PhraseKey): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const current = readMemory(key);
  const db = await openDatabase();
  const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(TRANSLATIONS_STORE);
  if (!current) store.delete([key.source, key.target, key.phrase]);
  else {
    store.put({
      source: key.source,
      target: key.target,
      phrase: key.phrase,
      text: current.text,
      dates: [...current.dates],
    });
  }
  await done;
  phraseTranslationListener?.(key.source);
}

async function readDatabase(): Promise<StoredPhraseTranslation[]> {
  const db = await openDatabase();
  const result = await idbRequest(
    db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE).getAll(),
  );
  return normalizeStoredPhraseTranslations(result);
}

function putRecords(tx: IDBTransaction, records: readonly StoredPhraseTranslation[]): void {
  const store = tx.objectStore(TRANSLATIONS_STORE);
  store.clear();
  for (const record of records) store.put({ ...record, dates: [...record.dates] });
}

function snapshot(): StoredPhraseTranslation[] {
  const records: StoredPhraseTranslation[] = [];
  for (const [source, byTarget] of memory) {
    for (const [target, byPhrase] of byTarget) {
      for (const [phrase, value] of byPhrase) {
        records.push({
          source,
          target,
          phrase,
          text: value.text,
          dates: [...value.dates],
        });
      }
    }
  }
  records.sort(compareRecords);
  return records;
}

function rememberIfAbsent(record: StoredPhraseTranslation): void {
  const key = phraseKey(record.source, record.target, record.phrase);
  if (!key || readMemory(key)) return;
  writeMemory(key, { text: record.text, dates: record.dates });
}

function readMemory(key: PhraseKey): PhraseTranslation | null {
  return memory.get(key.source)?.get(key.target)?.get(key.phrase) ?? null;
}

function writeMemory(key: PhraseKey, value: PhraseTranslation): void {
  let byTarget = memory.get(key.source);
  if (!byTarget) {
    byTarget = new Map();
    memory.set(key.source, byTarget);
  }
  let byPhrase = byTarget.get(key.target);
  if (!byPhrase) {
    byPhrase = new Map();
    byTarget.set(key.target, byPhrase);
  }
  byPhrase.set(key.phrase, value);
}

function deleteMemory(key: PhraseKey): void {
  const byTarget = memory.get(key.source);
  const byPhrase = byTarget?.get(key.target);
  if (!byPhrase?.delete(key.phrase)) return;
  if (byPhrase.size === 0) byTarget?.delete(key.target);
  if (byTarget && byTarget.size === 0) memory.delete(key.source);
}

function phraseKey(sourceLang: string, targetLang: string, phrase: string): PhraseKey | null {
  const source = sourceLang.trim().toLowerCase();
  const target = targetLang.trim().toLowerCase();
  const text = phrase.trim();
  if (!source || !target || source === target || !text) return null;
  return { source, target, phrase: text };
}

function recordOf(value: unknown): StoredPhraseTranslation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as { source?: unknown; target?: unknown; phrase?: unknown };
  return recordFromEntry(
    String(source.source ?? ''),
    String(source.target ?? ''),
    String(source.phrase ?? ''),
    value,
  );
}

function recordFromEntry(
  source: string,
  target: string,
  phrase: string,
  entry: unknown,
): StoredPhraseTranslation | null {
  const key = phraseKey(source, target, phrase);
  const body = translationOf(entry);
  if (!key || !body) return null;
  return { ...key, text: body.text, dates: body.dates };
}

function translationOf(value: unknown): PhraseTranslation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = String((value as { text?: unknown }).text ?? '').trim();
  if (!text) return null;
  return { text, dates: datesOf((value as { dates?: unknown }).dates) };
}

function datesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && isoInstant(item));
}

function isoInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function recordKey(record: StoredPhraseTranslation): string {
  return JSON.stringify([record.source, record.target, record.phrase]);
}

function compareRecords(left: StoredPhraseTranslation, right: StoredPhraseTranslation): number {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.phrase.localeCompare(right.phrase)
  );
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    tx.onabort = fail;
  });
}
