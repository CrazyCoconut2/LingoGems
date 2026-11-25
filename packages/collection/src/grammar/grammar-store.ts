import { GRAMMAR_STORE, idbRequest, openDatabase } from '../database';
import { isLearnableLanguage, type LearnableLanguage } from '../languages/catalog';

const BEFORE_MAX = 1000;
const RULE_MAX = 300;
const SPAN_MAX = 200;
const ID_MAX = 80;

/** One correction. The rules are what that sentence violated or followed. */
export type GrammarInput = {
  id: string;
  language: LearnableLanguage;
  at: number;
  before: string;
  after: string;
  rules: GrammarInputRule[];
};

/** A rule on one correction. The id is stable across sentences. */
export type GrammarInputRule = {
  id: string;
  rule: string;
  outcome: 'committed' | 'resolved';
  instances: GrammarInstance[];
};

/**
 * A rule gathered from every correction that mentioned it.
 * `before` and `after` are the newest sentence that did.
 */
export type GrammarMistake = {
  id: string;
  language: LearnableLanguage;
  rule: string;
  before: string;
  after: string;
  at: number;
  outcome: 'committed' | 'resolved';
};

/** The words in one sentence that broke a rule, and what those words should be. */
export type GrammarInstance = {
  wrote: string;
  correction: string;
};

export type GrammarMark =
  | { kind: 'text'; text: string }
  | { kind: 'fix'; wrote: string; correction: string; colored: boolean }
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

/** True when the newest mention of this rule is a violation. */
export function grammarMistakeOpen(mistake: GrammarMistake): boolean {
  return mistake.outcome === 'committed';
}

/** Every correction for this language, newest first. */
export async function readGrammarInputs(language: string): Promise<GrammarInput[]> {
  const code = languageCode(language);
  if (!code || typeof indexedDB === 'undefined') return [];
  const rows = await readLanguage(code);
  return rows.sort(newestInput);
}

/** Every rule mentioned in this language, newest mention first. */
export async function readGrammarMistakes(language: string): Promise<GrammarMistake[]> {
  return grammarRules(await readGrammarInputs(language));
}

/** Rules whose newest mention is still a violation, newest first. */
export async function readOpenGrammarMistakes(language: string): Promise<GrammarMistake[]> {
  const rows = await readGrammarMistakes(language);
  return rows.filter(grammarMistakeOpen);
}

/** One rule per id. A later correction replaces an earlier mention of that rule. */
export function grammarRules(inputs: readonly GrammarInput[]): GrammarMistake[] {
  const rules = new Map<string, GrammarMistake>();
  for (const input of inputs) {
    for (const entry of input.rules) {
      const current = rules.get(entry.id);
      if (current && current.at > input.at) continue;
      if (current && current.at === input.at && current.outcome === 'committed') continue;
      rules.set(entry.id, {
        id: entry.id,
        language: input.language,
        rule: entry.rule,
        before: input.before,
        after: input.after,
        at: input.at,
        outcome: entry.outcome,
      });
    }
  }
  return [...rules.values()].sort(newestMistake);
}

/**
 * Records this sentence as one correction.
 * A rule the sentence breaks is stored as committed. A prior rule it follows is stored as resolved.
 * The same rule in another sentence reuses that rule's id.
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

  const existing = await readGrammarInputs(language);
  const rules = rulesForOutcome(existing, committed, resolved);
  if (!rules.length) return;
  const row: GrammarInput = {
    id: crypto.randomUUID(),
    language,
    at,
    before,
    after,
    rules,
  };
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(GRAMMAR_STORE).put(stored(row));
  await done;
}

/** Removes one rule from every correction. A correction left with no rules is removed. */
export async function deleteGrammarMistake(id: string): Promise<void> {
  const key = clip(id, ID_MAX);
  if (!key || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(GRAMMAR_STORE);
  const result = await idbRequest(store.getAll());
  if (Array.isArray(result)) {
    for (const item of result) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const rowId = clip(source['id'], ID_MAX);
      if (!rowId) continue;
      const input = normalizeInput(source);
      if (!input) {
        if (rowId === key) store.delete(rowId);
        continue;
      }
      if (!input.rules.some((rule) => rule.id === key)) continue;
      const rules = input.rules.filter((rule) => rule.id !== key);
      if (!rules.length) store.delete(input.id);
      else store.put(stored({ ...input, rules }));
    }
  }
  await done;
}

async function readLanguage(language: LearnableLanguage): Promise<GrammarInput[]> {
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readonly');
  const done = transactionDone(tx);
  const request = tx.objectStore(GRAMMAR_STORE).index('language').getAll(language);
  const result = await idbRequest(request);
  await done;
  if (!Array.isArray(result)) return [];
  const inputs: GrammarInput[] = [];
  const legacy: LegacyRule[] = [];
  for (const item of result) {
    const input = normalizeInput(item);
    if (input && input.language === language) {
      inputs.push(input);
      continue;
    }
    const rule = normalizeLegacy(item);
    if (rule && rule.language === language) legacy.push(rule);
  }
  if (!legacy.length) return inputs;
  const folded = foldLegacy(legacy);
  await replaceLegacy(legacy, folded);
  const byId = new Map(inputs.map((input) => [input.id, input]));
  for (const input of folded) byId.set(input.id, input);
  return [...byId.values()];
}

async function replaceLegacy(
  legacy: readonly LegacyRule[],
  folded: readonly GrammarInput[],
): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(GRAMMAR_STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(GRAMMAR_STORE);
  for (const rule of legacy) store.delete(rule.id);
  for (const input of folded) store.put(stored(input));
  await done;
}

function rulesForOutcome(
  existing: readonly GrammarInput[],
  committed: readonly GrammarCommit[],
  resolved: readonly GrammarResolution[],
): GrammarInputRule[] {
  const byId = new Map<string, { id: string; rule: string }>();
  const byText = new Map<string, { id: string; rule: string }>();
  for (const input of existing) {
    for (const entry of input.rules) {
      const known = { id: entry.id, rule: entry.rule };
      if (!byId.has(entry.id)) byId.set(entry.id, known);
      const key = ruleKey(entry.rule);
      if (!byText.has(key)) byText.set(key, known);
    }
  }
  const rules: GrammarInputRule[] = [];
  const committedIds = new Set<string>();
  for (const bucket of groupCommits(committed)) {
    const known = (bucket.id && byId.get(bucket.id)) || byText.get(ruleKey(bucket.rule));
    const id = known?.id ?? crypto.randomUUID();
    const rule = known?.rule ?? bucket.rule;
    if (committedIds.has(id)) {
      const current = rules.find((entry) => entry.id === id);
      if (current && bucket.instances.length) {
        current.instances = mergeInstances(current.instances, bucket.instances);
      }
      continue;
    }
    committedIds.add(id);
    const knownRule = { id, rule };
    byId.set(id, knownRule);
    byText.set(ruleKey(rule), knownRule);
    byText.set(ruleKey(bucket.rule), knownRule);
    rules.push({ id, rule, outcome: 'committed', instances: bucket.instances });
  }
  for (const item of resolved) {
    const known = byId.get(item.id);
    if (!known || committedIds.has(known.id)) continue;
    const followed = clip(item.wrote, SPAN_MAX);
    rules.push({
      id: known.id,
      rule: known.rule,
      outcome: 'resolved',
      instances: followed ? [{ wrote: followed, correction: followed }] : [],
    });
  }
  return rules;
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

function stored(row: GrammarInput): GrammarInput {
  return {
    id: row.id,
    language: row.language,
    at: row.at,
    before: row.before,
    after: row.after,
    rules: row.rules.map((rule) => ({
      id: rule.id,
      rule: rule.rule,
      outcome: rule.outcome,
      instances: rule.instances.map((instance) => ({ ...instance })),
    })),
  };
}

/**
 * The corrected sentence, with every violated span shown as the words that were written
 * beside the fix. `colored` is the span that belongs to the rule the learner picked.
 */
export function grammarCorrectionMarks(
  sentence: string,
  groups: readonly {
    instances: readonly GrammarInstance[];
    colored: boolean;
    followed?: boolean;
  }[],
): GrammarMark[] {
  const text = sentence;
  if (!text) return [];
  const ranges: {
    start: number;
    end: number;
    wrote: string;
    colored: boolean;
    followed: boolean;
  }[] = [];
  const spans: { needle: string; wrote: string; colored: boolean; followed: boolean }[] = [];
  for (const group of groups) {
    for (const instance of group.instances) {
      const wrote = instance.wrote.trim();
      const correction = instance.correction.trim();
      const followed = group.followed === true;
      if (!wrote || !correction) continue;
      if (!followed && wrote.toLowerCase() === correction.toLowerCase()) continue;
      if (followed && !group.colored) continue;
      spans.push({
        needle: followed ? wrote : correction,
        wrote,
        colored: group.colored,
        followed,
      });
    }
  }
  spans.sort((left, right) => right.needle.length - left.needle.length);
  for (const span of spans) {
    const found = findSpan(text, span.needle, ranges);
    if (found)
      ranges.push({ ...found, wrote: span.wrote, colored: span.colored, followed: span.followed });
  }
  ranges.sort((left, right) => left.start - right.start);
  const marks: GrammarMark[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) marks.push({ kind: 'text', text: text.slice(cursor, range.start) });
    const slice = text.slice(range.start, range.end);
    marks.push(
      range.followed
        ? { kind: 'good', text: slice }
        : { kind: 'fix', wrote: range.wrote, correction: slice, colored: range.colored },
    );
    cursor = range.end;
  }
  if (cursor < text.length) marks.push({ kind: 'text', text: text.slice(cursor) });
  return marks.length ? marks : [{ kind: 'text', text }];
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
        : { kind: 'fix', wrote: range.wrote, correction: slice, colored: true },
    );
    cursor = range.end;
  }
  if (cursor < text.length) marks.push({ kind: 'text', text: text.slice(cursor) });
  return marks.length ? marks : [{ kind: 'text', text }];
}

function normalizeInput(value: unknown): GrammarInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source['rules'])) return null;
  const id = clip(source['id'], ID_MAX);
  const language = languageCode(String(source['language'] ?? ''));
  const at = finiteTime(source['at']);
  const before = clip(source['before'], BEFORE_MAX);
  const after = clip(source['after'], BEFORE_MAX);
  const rules = rulesOf(source['rules']);
  if (!id || !language || !at || !before || !after || !rules.length) return null;
  return { id, language, at, before, after, rules };
}

function rulesOf(value: unknown): GrammarInputRule[] {
  if (!Array.isArray(value)) return [];
  const rules: GrammarInputRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const id = clip(source['id'], ID_MAX);
    const rule = clip(source['rule'], RULE_MAX);
    const outcome =
      source['outcome'] === 'resolved'
        ? 'resolved'
        : source['outcome'] === 'committed'
          ? 'committed'
          : null;
    if (!id || !rule || !outcome) continue;
    const instances = outcome === 'resolved' ? followedInstances(source) : instancesOf(source);
    placeRule(rules, { id, rule, outcome, instances });
  }
  return rules;
}

type LegacyOccurrence = {
  at: number;
  outcome: 'committed' | 'resolved';
  before: string;
  after: string;
  instances: GrammarInstance[];
};

type LegacyRule = {
  id: string;
  language: LearnableLanguage;
  rule: string;
  occurrences: LegacyOccurrence[];
};

/** Rows saved as one rule with a list of sentences become one correction per sentence. */
function normalizeLegacy(value: unknown): LegacyRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Array.isArray(source['rules'])) return null;
  const id = clip(source['id'], ID_MAX);
  const language = languageCode(String(source['language'] ?? ''));
  const rule = clip(source['rule'], RULE_MAX) || legacyRule(source);
  const occurrences = occurrencesOf(source);
  if (!id || !language || !rule || !occurrences.length) return null;
  return { id, language, rule, occurrences };
}

function foldLegacy(rules: readonly LegacyRule[]): GrammarInput[] {
  const groups = new Map<string, GrammarInput>();
  for (const rule of rules) {
    for (const occurrence of rule.occurrences) {
      const id = legacyInputId(rule.language, occurrence);
      const group = groups.get(id) ?? {
        id,
        language: rule.language,
        at: occurrence.at,
        before: occurrence.before,
        after: occurrence.after,
        rules: [],
      };
      placeRule(group.rules, {
        id: rule.id,
        rule: rule.rule,
        outcome: occurrence.outcome,
        instances: occurrence.instances,
      });
      groups.set(id, group);
    }
  }
  return [...groups.values()];
}

function legacyInputId(language: LearnableLanguage, occurrence: LegacyOccurrence): string {
  const hash = djb2(
    `${language}\n${occurrence.at}\n${occurrence.before}\n${occurrence.after}`,
  ).toString(16);
  return clip(`in-${occurrence.at}-${hash}`, ID_MAX);
}

function djb2(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function placeRule(rules: GrammarInputRule[], entry: GrammarInputRule): void {
  const index = rules.findIndex((rule) => rule.id === entry.id);
  if (index < 0) {
    rules.push(entry);
    return;
  }
  const current = rules[index];
  if (current.outcome === 'committed' && entry.outcome === 'resolved') return;
  if (current.outcome === 'committed' && entry.outcome === 'committed') {
    rules[index] = { ...entry, instances: mergeInstances(current.instances, entry.instances) };
    return;
  }
  rules[index] = entry;
}

function occurrencesOf(source: Record<string, unknown>): LegacyOccurrence[] {
  if (Array.isArray(source['occurrences'])) {
    const rows: LegacyOccurrence[] = [];
    for (const item of source['occurrences']) {
      const occurrence = occurrenceOf(item);
      if (occurrence) rows.push(occurrence);
    }
    if (rows.length) return rows.sort((left, right) => left.at - right.at);
  }
  return legacyOccurrences(source);
}

function occurrenceOf(value: unknown): LegacyOccurrence | null {
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
function legacyOccurrences(source: Record<string, unknown>): LegacyOccurrence[] {
  const before = clip(source['before'], BEFORE_MAX);
  const after = clip(source['after'], BEFORE_MAX);
  if (!before || !after) return [];
  const instances = instancesOf(source);
  const committedAt = Array.isArray(source['committedAt'])
    ? timesOf(source['committedAt'])
    : timesOf(source['createdAt']);
  const resolvedAt = timesOf(source['resolvedAt']);
  const rows: LegacyOccurrence[] = [];
  for (const at of committedAt) rows.push({ at, outcome: 'committed', before, after, instances });
  for (const at of resolvedAt) rows.push({ at, outcome: 'resolved', before, after, instances: [] });
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

function newestInput(left: GrammarInput, right: GrammarInput): number {
  return right.at - left.at || left.id.localeCompare(right.id);
}

function newestMistake(left: GrammarMistake, right: GrammarMistake): number {
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
