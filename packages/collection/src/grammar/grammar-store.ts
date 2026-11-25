import { GRAMMAR_STORE, idbRequest, openDatabase } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from '../languages/catalog';

const BEFORE_MAX = 1000;
const RULE_MAX = 300;
const SPAN_MAX = 200;
const ID_MAX = 80;

/**
 * One grammatical rule. Each time it is broken or followed is its own sentence,
 * because a later sentence can repeat the error or get it right somewhere else.
 */
export type GrammarMistake = {
  id: string;
  language: LearnableLanguage;
  /** The general rule that was broken, not the words from one sentence. */
  rule: string;
  /** Every time this rule was broken or followed, oldest first. */
  occurrences: GrammarOccurrence[];
};

/** One sentence in which this rule was broken, or a later sentence that followed it. */
export type GrammarOccurrence = {
  at: number;
  outcome: 'committed' | 'resolved';
  /** The sentence the learner wrote. */
  before: string;
  /** That sentence after the fixes. */
  after: string;
  /**
   * A commit stores each span that broke this rule.
   * A resolution stores the span that followed it. `correction` then equals `wrote`.
   */
  instances: GrammarInstance[];
};

/** The words in one sentence that broke a rule, and what those words should be. */
export type GrammarInstance = {
  wrote: string;
  correction: string;
};

export type GrammarMark =
  | { kind: 'text'; text: string }
  | { kind: 'fix'; wrote: string; correction: string }
  | { kind: 'good'; text: string };

export type GrammarCommit = {
  id?: string;
  rule: string;
  wrote: string;
  correction: string;
};

export type GrammarResolution = {
  id: string;
  /** Span in the learner sentence that follows the rule. Empty when the model did not mark one. */
  wrote: string;
};

/** True when the latest event for this error is a commit, not a sentence that avoided it. */
export function grammarMistakeOpen(mistake: GrammarMistake): boolean {
  return latestOccurrence(mistake)?.outcome === 'committed';
}

/** Every stored mistake for this language, most recently active first. */
export async function readGrammarMistakes(language: string): Promise<GrammarMistake[]> {
  const code = languageCode(language);
  if (!code || typeof indexedDB === 'undefined') return [];
  const rows = await readLanguage(code);
  return rows.sort(newestFirst);
}

/** Mistakes whose latest event is still a commit, most recently active first. */
export async function readOpenGrammarMistakes(language: string): Promise<GrammarMistake[]> {
  const rows = await readGrammarMistakes(language);
  return rows.filter(grammarMistakeOpen);
}

/**
 * Records this sentence against known errors.
 * A committed rule appends this sentence and the spans that broke it.
 * A resolved rule appends this sentence and the span that followed it.
 */
export async function applyGrammarOutcome(input: {
  language: string;
  before: string;
  after: string;
  at: number;
  committed: readonly GrammarCommit[];
  resolved: readonly GrammarResolution[];
}): Promise<void> {
  const language = languageCode(input.language);
  const at = finiteTime(input.at);
  const before = clip(input.before, BEFORE_MAX);
  const after = clip(input.after, BEFORE_MAX);
  if (!language || !at || !before || !after || typeof indexedDB === 'undefined') return;
  const committed = commitsOf(input.committed);
  const resolved = resolutionsOf(input.resolved);
  if (!committed.length && !resolved.length) return;

  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(GRAMMAR_STORE);
  const existing = await idbRequest(store.index('language').getAll(language));
  const rows = new Map<string, GrammarMistake>();
  const byRule = new Map<string, GrammarMistake>();
  if (Array.isArray(existing)) {
    for (const item of existing) {
      const row = normalize(item);
      if (!row || row.language !== language) continue;
      rows.set(row.id, row);
      byRule.set(ruleKey(row.rule), row);
    }
  }
  const touchedIds = new Set<string>();
  const touchedRules = new Set<string>();
  for (const bucket of groupCommits(committed)) {
    const known = (bucket.id && rows.get(bucket.id)) || byRule.get(ruleKey(bucket.rule));
    const occurrence: GrammarOccurrence = {
      at,
      outcome: 'committed',
      before,
      after,
      instances: bucket.instances,
    };
    if (known) {
      const next = appendOccurrence(known, occurrence);
      touchedIds.add(next.id);
      touchedRules.add(ruleKey(next.rule));
      rows.set(next.id, next);
      byRule.set(ruleKey(next.rule), next);
      continue;
    }
    const id = crypto.randomUUID();
    const created: GrammarMistake = {
      id,
      language,
      rule: bucket.rule,
      occurrences: [occurrence],
    };
    touchedIds.add(id);
    touchedRules.add(ruleKey(created.rule));
    rows.set(id, created);
    byRule.set(ruleKey(created.rule), created);
  }
  for (const item of resolved) {
    const known = rows.get(item.id);
    if (!known || touchedIds.has(known.id) || touchedRules.has(ruleKey(known.rule))) continue;
    const followed = clip(item.wrote, SPAN_MAX);
    const next = appendOccurrence(known, {
      at,
      outcome: 'resolved',
      before,
      after,
      instances: followed ? [{ wrote: followed, correction: followed }] : [],
    });
    rows.set(next.id, next);
    byRule.set(ruleKey(next.rule), next);
  }
  for (const row of rows.values()) store.put(stored(row));
  await done;
}

/** Removes one stored mistake. An unknown id does nothing. */
export async function deleteGrammarMistake(id: string): Promise<void> {
  const key = clip(id, ID_MAX);
  if (!key || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(GRAMMAR_STORE).delete(key);
  await done;
}

async function readLanguage(language: LearnableLanguage): Promise<GrammarMistake[]> {
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readonly');
  const done = transactionDone(tx);
  const request = tx.objectStore(GRAMMAR_STORE).index('language').getAll(language);
  const result = await idbRequest(request);
  await done;
  if (!Array.isArray(result)) return [];
  const rows: GrammarMistake[] = [];
  for (const item of result) {
    const row = normalize(item);
    if (row && row.language === language) rows.push(row);
  }
  return rows;
}

function groupCommits(
  commits: readonly GrammarCommit[],
): { id?: string; rule: string; instances: GrammarInstance[] }[] {
  const groups = new Map<string, { id?: string; rule: string; instances: GrammarInstance[] }>();
  for (const commit of commits) {
    const key = commit.id || ruleKey(commit.rule);
    const instance = violationOf(commit.wrote, commit.correction);
    const group = groups.get(key);
    if (group) {
      if (instance) group.instances = mergeInstances(group.instances, [instance]);
      continue;
    }
    groups.set(key, {
      ...(commit.id ? { id: commit.id } : {}),
      rule: commit.rule,
      instances: instance ? [instance] : [],
    });
  }
  return [...groups.values()];
}

function commitsOf(commits: readonly GrammarCommit[]): GrammarCommit[] {
  const seen = new Set<string>();
  const rows: GrammarCommit[] = [];
  for (const commit of commits) {
    const id = clip(commit.id, ID_MAX);
    const rule = clip(commit.rule, RULE_MAX);
    const wrote = clip(commit.wrote, SPAN_MAX);
    const correction = clip(commit.correction, SPAN_MAX);
    if (!rule) continue;
    const key = `${id || ruleKey(rule)}\n${wrote.toLowerCase()}\n${correction.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row: GrammarCommit = { rule, wrote, correction };
    if (id) row.id = id;
    rows.push(row);
  }
  return rows;
}

function resolutionsOf(items: readonly GrammarResolution[]): GrammarResolution[] {
  const seen = new Set<string>();
  const rows: GrammarResolution[] = [];
  for (const item of items) {
    const id = clip(item.id, ID_MAX);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, wrote: clip(item.wrote, SPAN_MAX) });
  }
  return rows;
}

function appendOccurrence(row: GrammarMistake, occurrence: GrammarOccurrence): GrammarMistake {
  const index = row.occurrences.findIndex(
    (item) => item.at === occurrence.at && item.outcome === occurrence.outcome,
  );
  if (index < 0) {
    return {
      ...row,
      occurrences: [...row.occurrences, occurrence].sort((left, right) => left.at - right.at),
    };
  }
  const current = row.occurrences[index];
  const next = [...row.occurrences];
  next[index] = {
    ...current,
    before: occurrence.before,
    after: occurrence.after,
    instances: mergeInstances(current.instances, occurrence.instances),
  };
  return { ...row, occurrences: next };
}

function stored(row: GrammarMistake): GrammarMistake {
  return {
    id: row.id,
    language: row.language,
    rule: row.rule,
    occurrences: row.occurrences.map((occurrence) => ({
      at: occurrence.at,
      outcome: occurrence.outcome,
      before: occurrence.before,
      after: occurrence.after,
      instances: occurrence.instances.map((instance) => ({ ...instance })),
    })),
  };
}

/**
 * The corrected sentence, with only this rule's spans marked.
 * `wrong` keeps the committed words beside the fix. `right` marks the span that followed the rule.
 */
export function grammarSentenceMarks(
  sentence: string,
  instances: readonly GrammarInstance[],
  tone: 'wrong' | 'right' = 'wrong',
): GrammarMark[] {
  const text = sentence;
  if (!text) return [];
  const ranges: { start: number; end: number; wrote: string }[] = [];
  const spans = [...instances].sort(
    (left, right) => spanNeedle(right, tone).length - spanNeedle(left, tone).length,
  );
  for (const instance of spans) {
    const wrote = instance.wrote.trim();
    const correction = instance.correction.trim();
    const needle = spanNeedle(instance, tone);
    if (!needle) continue;
    if (
      tone === 'wrong' &&
      (!wrote || !correction || wrote.toLowerCase() === correction.toLowerCase())
    )
      continue;
    const found = findSpan(text, needle, ranges);
    if (found) ranges.push({ ...found, wrote });
  }
  ranges.sort((left, right) => left.start - right.start);
  const marks: GrammarMark[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) marks.push({ kind: 'text', text: text.slice(cursor, range.start) });
    const slice = text.slice(range.start, range.end);
    marks.push(
      tone === 'right'
        ? { kind: 'good', text: slice }
        : { kind: 'fix', wrote: range.wrote, correction: slice },
    );
    cursor = range.end;
  }
  if (cursor < text.length) marks.push({ kind: 'text', text: text.slice(cursor) });
  return marks.length ? marks : [{ kind: 'text', text }];
}

function normalize(value: unknown): GrammarMistake | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = clip(source['id'], ID_MAX);
  const language = languageCode(String(source['language'] ?? ''));
  const rule = clip(source['rule'], RULE_MAX) || legacyRule(source);
  const occurrences = occurrencesOf(source);
  if (!id || !language || !rule || !occurrences.length) return null;
  return { id, language, rule, occurrences };
}

function occurrencesOf(source: Record<string, unknown>): GrammarOccurrence[] {
  if (Array.isArray(source['occurrences'])) {
    const rows: GrammarOccurrence[] = [];
    for (const item of source['occurrences']) {
      const occurrence = occurrenceOf(item);
      if (occurrence) rows.push(occurrence);
    }
    if (rows.length) return rows.sort((left, right) => left.at - right.at);
  }
  return legacyOccurrences(source);
}

function occurrenceOf(value: unknown): GrammarOccurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const at = finiteTime(source['at']);
  const outcome =
    source['outcome'] === 'resolved'
      ? 'resolved'
      : source['outcome'] === 'committed'
        ? 'committed'
        : null;
  const before = clip(source['before'], BEFORE_MAX);
  const after = clip(source['after'], BEFORE_MAX);
  if (!at || !outcome || !before || !after) return null;
  return {
    at,
    outcome,
    before,
    after,
    instances: outcome === 'resolved' ? followedInstances(source) : instancesOf(source),
  };
}

/** Rows saved before each occasion kept its own sentence share one before and after across every time. */
function legacyOccurrences(source: Record<string, unknown>): GrammarOccurrence[] {
  const before = clip(source['before'], BEFORE_MAX);
  const after = clip(source['after'], BEFORE_MAX);
  if (!before || !after) return [];
  const instances = instancesOf(source);
  const committedAt = Array.isArray(source['committedAt'])
    ? timesOf(source['committedAt'])
    : timesOf(source['createdAt']);
  const resolvedAt = timesOf(source['resolvedAt']);
  const rows: GrammarOccurrence[] = [];
  for (const at of committedAt) {
    rows.push({ at, outcome: 'committed', before, after, instances });
  }
  for (const at of resolvedAt) {
    rows.push({ at, outcome: 'resolved', before, after, instances: [] });
  }
  return rows.sort((left, right) => left.at - right.at);
}

function instancesOf(source: Record<string, unknown>): GrammarInstance[] {
  const list = source['instances'];
  const rows = Array.isArray(list) ? list : [source];
  const seen = new Set<string>();
  const instances: GrammarInstance[] = [];
  for (const item of rows) {
    const instance = violationFrom(item);
    if (!instance) continue;
    const key = instanceKey(instance);
    if (seen.has(key)) continue;
    seen.add(key);
    instances.push(instance);
  }
  return instances;
}

function followedInstances(source: Record<string, unknown>): GrammarInstance[] {
  const list = source['instances'];
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const instances: GrammarInstance[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const wrote = clip((item as Record<string, unknown>)['wrote'], SPAN_MAX);
    if (!wrote) continue;
    const key = wrote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    instances.push({ wrote, correction: wrote });
  }
  return instances;
}

function violationFrom(value: unknown): GrammarInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return violationOf(clip(row['wrote'], SPAN_MAX), clip(row['correction'], SPAN_MAX));
}

function violationOf(wrote: string, correction: string): GrammarInstance | null {
  if (!wrote || !correction || wrote.toLowerCase() === correction.toLowerCase()) return null;
  return { wrote, correction };
}

function mergeInstances(
  current: readonly GrammarInstance[],
  extra: readonly GrammarInstance[],
): GrammarInstance[] {
  const seen = new Set(current.map(instanceKey));
  const next = [...current];
  for (const instance of extra) {
    const key = instanceKey(instance);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(instance);
  }
  return next;
}

function instanceKey(instance: GrammarInstance): string {
  return `${instance.wrote.toLowerCase()}\n${instance.correction.toLowerCase()}`;
}

function spanNeedle(instance: GrammarInstance, tone: 'wrong' | 'right'): string {
  return (tone === 'right' ? instance.wrote : instance.correction).trim();
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

/** Older rows stored the corrected span. Keep them visible so they can be deleted. */
function legacyRule(source: Record<string, unknown>): string {
  const wrote = clip(source['wrote'], SPAN_MAX);
  const correction = clip(source['correction'], SPAN_MAX);
  if (!wrote || !correction || wrote.toLowerCase() === correction.toLowerCase()) return '';
  return clip(`${wrote} → ${correction}`, RULE_MAX);
}

function timesOf(value: unknown): number[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set<number>();
  const times: number[] = [];
  for (const item of list) {
    const time = finiteTime(item);
    if (!time || seen.has(time)) continue;
    seen.add(time);
    times.push(time);
  }
  times.sort((left, right) => left - right);
  return times;
}

function languageCode(language: string): LearnableLanguage | null {
  const code = language.trim().toLowerCase();
  return isLearnableLanguage(code) ? code : null;
}

function ruleKey(rule: string): string {
  return rule.toLowerCase();
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

function latestOccurrence(mistake: GrammarMistake): GrammarOccurrence | null {
  let latest: GrammarOccurrence | null = null;
  for (const occurrence of mistake.occurrences) {
    if (!latest || occurrence.at > latest.at) latest = occurrence;
  }
  return latest;
}

function newestFirst(left: GrammarMistake, right: GrammarMistake): number {
  const activity = latestOccurrence(right)?.at ?? 0;
  const other = latestOccurrence(left)?.at ?? 0;
  return activity - other || left.id.localeCompare(right.id);
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
