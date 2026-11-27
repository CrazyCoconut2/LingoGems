import { idbRequest, openDatabase, REFORMULATION_STORE } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from '../languages/catalog';

const TEXT_MAX = 1000;
const SPAN_MAX = 200;
const REASON_MAX = 300;
const ID_MAX = 80;
const CHANGE_MAX = 8;

/** One span the accepted wording changed, and why. */
export type ReformulationChange = {
  wrote: string;
  reformulation: string;
  reason: string;
};

/** A wording the learner accepted. */
export type StoredReformulation = {
  id: string;
  language: LearnableLanguage;
  elementId: string;
  at: number;
  source: string;
  text: string;
  changes: ReformulationChange[];
};

export type ReformulationMark =
  { kind: 'text'; text: string } | { kind: 'change'; wrote: string; reformulation: string };

/** Accepted reformulations for this language, newest first. */
export async function readReformulations(language: string): Promise<StoredReformulation[]> {
  const code = languageCode(language);
  if (!code || typeof indexedDB === 'undefined') return [];
  const db = await openDatabase();
  const tx = db.transaction(REFORMULATION_STORE, 'readonly');
  const done = transactionDone(tx);
  const request = tx.objectStore(REFORMULATION_STORE).index('language').getAll(code);
  const result = await idbRequest(request);
  await done;
  if (!Array.isArray(result)) return [];
  const rows: StoredReformulation[] = [];
  for (const item of result) {
    const row = normalize(item);
    if (row && row.language === code) rows.push(row);
  }
  return rows.sort(newest);
}

/**
 * Records one accepted reformulation.
 * Returns null when the sentence, the language, or the changes cannot be stored.
 */
export async function saveReformulation(input: {
  language: string;
  elementId: string;
  source: string;
  text: string;
  changes: readonly ReformulationChange[];
  at: number;
}): Promise<StoredReformulation | null> {
  const language = languageCode(input.language);
  const elementId = clip(input.elementId, ID_MAX);
  const at = finiteTime(input.at);
  const source = clip(input.source, TEXT_MAX);
  const text = clip(input.text, TEXT_MAX);
  if (!language || !elementId || !at || !source || !text || source === text) return null;
  if (typeof indexedDB === 'undefined') return null;
  const changes = changesOf(input.changes, source, text);
  if (!changes.length) return null;
  const row: StoredReformulation = {
    id: crypto.randomUUID(),
    language,
    elementId,
    at,
    source,
    text,
    changes,
  };
  const db = await openDatabase();
  const tx = db.transaction(REFORMULATION_STORE, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(REFORMULATION_STORE).put(row);
  await done;
  return row;
}

/** Point reformulations that belonged to `fromId` at `toId`. */
export async function retargetReformulations(fromId: string, toId: string): Promise<void> {
  const from = clip(fromId, ID_MAX);
  const to = clip(toId, ID_MAX);
  if (!from || !to || from === to || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const rows = await idbRequest(
    db.transaction(REFORMULATION_STORE, 'readonly').objectStore(REFORMULATION_STORE).getAll(),
  );
  if (!Array.isArray(rows)) return;
  const updates: StoredReformulation[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as StoredReformulation;
    if (row.elementId !== from || !row.id) continue;
    updates.push({ ...row, elementId: to });
  }
  if (!updates.length) return;
  const tx = db.transaction(REFORMULATION_STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(REFORMULATION_STORE);
  for (const row of updates) store.put(row);
  await done;
}

/** The suggestion, with each changed span shown as the words that were written beside the new wording. */
export function reformulationMarks(
  sentence: string,
  changes: readonly ReformulationChange[],
): ReformulationMark[] {
  const text = sentence;
  if (!text) return [];
  const ranges: { start: number; end: number; wrote: string; reformulation: string }[] = [];
  for (const change of changes) {
    const reformulation = change.reformulation.trim();
    const wrote = change.wrote.trim();
    if (!reformulation || !wrote || wrote === reformulation) continue;
    const found = findSpan(text, reformulation, ranges);
    if (!found) continue;
    ranges.push({ ...found, wrote, reformulation });
  }
  ranges.sort((left, right) => left.start - right.start);
  const marks: ReformulationMark[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) marks.push({ kind: 'text', text: text.slice(cursor, range.start) });
    marks.push({
      kind: 'change',
      wrote: range.wrote,
      reformulation: text.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  if (cursor < text.length) marks.push({ kind: 'text', text: text.slice(cursor) });
  return marks.length ? marks : [{ kind: 'text', text }];
}

function changesOf(
  value: readonly ReformulationChange[],
  source: string,
  text: string,
): ReformulationChange[] {
  const takenSource: { start: number; end: number }[] = [];
  const takenText: { start: number; end: number }[] = [];
  const placed: { start: number; change: ReformulationChange }[] = [];
  for (const item of value) {
    const wrote = clip(item.wrote, SPAN_MAX);
    const reformulation = clip(item.reformulation, SPAN_MAX);
    const reason = clip(item.reason, REASON_MAX);
    if (!wrote || !reformulation || !reason || wrote === reformulation) continue;
    const wroteAt = findSpan(source, wrote, takenSource);
    const nextAt = findSpan(text, reformulation, takenText);
    if (!wroteAt || !nextAt) continue;
    const wroteSlice = source.slice(wroteAt.start, wroteAt.end);
    const nextSlice = text.slice(nextAt.start, nextAt.end);
    if (wroteSlice === nextSlice) continue;
    takenSource.push(wroteAt);
    takenText.push(nextAt);
    placed.push({
      start: nextAt.start,
      change: { wrote: wroteSlice, reformulation: nextSlice, reason },
    });
    if (placed.length >= CHANGE_MAX) break;
  }
  placed.sort((left, right) => left.start - right.start);
  return placed.map((item) => item.change);
}

function normalize(value: unknown): StoredReformulation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = clip(source['id'], ID_MAX);
  const language = languageCode(source['language']);
  const elementId = clip(source['elementId'], ID_MAX);
  const at = finiteTime(source['at']);
  const from = clip(source['source'], TEXT_MAX);
  const text = clip(source['text'], TEXT_MAX);
  if (!id || !language || !elementId || !at || !from || !text || from === text) return null;
  const changes = changesOf(changesFrom(source['changes']), from, text);
  if (!changes.length) return null;
  return { id, language, elementId, at, source: from, text, changes };
}

function changesFrom(value: unknown): ReformulationChange[] {
  if (!Array.isArray(value)) return [];
  const changes: ReformulationChange[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    changes.push({
      wrote: clip(row['wrote'], SPAN_MAX),
      reformulation: clip(row['reformulation'], SPAN_MAX),
      reason: clip(row['reason'], REASON_MAX),
    });
  }
  return changes;
}

function findSpan(
  text: string,
  needle: string,
  taken: readonly { start: number; end: number }[],
): { start: number; end: number } | null {
  return nextMatch(text, needle, taken, false) ?? nextMatch(text, needle, taken, true);
}

function nextMatch(
  text: string,
  needle: string,
  taken: readonly { start: number; end: number }[],
  ignoreCase: boolean,
): { start: number; end: number } | null {
  const hay = ignoreCase ? text.toLowerCase() : text;
  const pin = ignoreCase ? needle.toLowerCase() : needle;
  let from = 0;
  while (from < hay.length) {
    const start = hay.indexOf(pin, from);
    if (start < 0) return null;
    const end = start + needle.length;
    const overlaps = taken.some((range) => start < range.end && end > range.start);
    if (!overlaps && bounded(text, start, end)) return { start, end };
    from = start + 1;
  }
  return null;
}

function bounded(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(char: string): boolean {
  return char !== '' && /[\p{L}\p{N}'’\-]/u.test(char);
}

function languageCode(language: unknown): LearnableLanguage | null {
  const code = clip(language, 12).toLowerCase();
  return isLearnableLanguage(code) ? code : null;
}

function clip(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function finiteTime(value: unknown): number | null {
  const time = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  return time;
}

function newest(left: StoredReformulation, right: StoredReformulation): number {
  return right.at - left.at || left.id.localeCompare(right.id);
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
