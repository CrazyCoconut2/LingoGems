import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const REFORMULATE_MAX_TOKENS = 2048;
const TEXT_MAX = 1000;
const LEMMA_MAX = 200;
const SPAN_MAX = 200;
const REASON_MAX = 300;
const SUGGESTION_MAX = 3;
const CHANGE_MAX = 8;

export type ReformulationSuggestion = {
  text: string;
  changes: {
    wrote: string;
    reformulation: string;
    reason: string;
  }[];
};

type SuggestReformulationsInput = {
  language: string;
  text: string;
  lemma?: string;
};

function reformulateSystemPrompt(language: string, hasLemma: boolean): string {
  const lines = [
    'You suggest other ways to say one sentence a learner wrote.',
    'JSON keys stay in English. The reason text does not.',
    `The sentence is in ${language}. Grammar and spelling are already corrected. Do not correct grammar or spelling. Do not change the meaning. Do not add a fact the learner did not state. Do not remove a meaning the learner stated.`,
    'suggestions lists reformulations. Each one is a different wording of the same sentence. Return more than one when more than one wording is clearly more natural. Return at most three. If the sentence is already a natural way to say this, suggestions is an empty array.',
    'text is the full reformulated sentence.',
    `changes lists every modification that text makes. A modification is one span that differs. wrote is the exact span in the learner sentence. reformulation is the exact span in text that replaces it. reason says why that modification is better, in one short sentence. reason MUST be written in ${language}. A French sentence gets a French reason. An English sentence gets an English reason. Do not write reason in English unless ${language} is English. wrote appears in the learner sentence. reformulation appears in text. wrote and reformulation differ. When text changes more than one place, changes has one entry for each place. A suggestion with no changes is omitted.`,
  ];
  if (hasLemma) {
    lines.push(
      'lemma is the headword this sentence defines. Keep that headword when the learner sentence uses it.',
    );
  }
  lines.push(
    'JSON only: {"suggestions":[{"text":"<sentence>","changes":[{"wrote":"<span>","reformulation":"<span>","reason":"<why>"}]}]}',
  );
  return lines.join('\n');
}

function languageName(code: string): string {
  const raw = code.trim();
  return languageDisplayName(raw) || raw;
}

function clip(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildUserMessage(input: SuggestReformulationsInput, text: string): string {
  const lemma = clip(input.lemma, LEMMA_MAX);
  return JSON.stringify({
    language: languageName(input.language),
    text,
    ...(lemma ? { lemma } : {}),
  });
}

/**
 * Other ways to say this sentence.
 * `source` is the sentence that was judged. An empty `suggestions` list means nothing to reformulate.
 * `null` means the reply had no usable suggestion.
 */
function parseSuggestions(
  parsed: unknown,
  source: string,
): ReformulationSuggestion[] | null {
  const row =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!row || !Array.isArray(row['suggestions'])) return null;
  const items = row['suggestions'];
  if (!items.length) return [];
  const seen = new Set<string>();
  const suggestions: ReformulationSuggestion[] = [];
  let dropped = 0;
  for (const item of items) {
    const suggestion = suggestionOf(item, source);
    if (!suggestion) {
      dropped += 1;
      continue;
    }
    const key = suggestion.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(suggestion);
    if (suggestions.length >= SUGGESTION_MAX) break;
  }
  if (!suggestions.length && dropped) return null;
  return suggestions;
}

function suggestionOf(value: unknown, source: string): ReformulationSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = clip((value as Record<string, unknown>)['text'], TEXT_MAX);
  if (!text || text === source) return null;
  const changes = changesOf((value as Record<string, unknown>)['changes'], source, text);
  if (!changes.length) return null;
  return { text, changes };
}

function changesOf(
  value: unknown,
  source: string,
  text: string,
): ReformulationSuggestion['changes'] {
  if (!Array.isArray(value)) return [];
  const takenSource: { start: number; end: number }[] = [];
  const takenText: { start: number; end: number }[] = [];
  const placed: { start: number; change: ReformulationSuggestion['changes'][number] }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const wrote = clip(row['wrote'], SPAN_MAX);
    const reformulation = clip(row['reformulation'], SPAN_MAX);
    const reason = clip(row['reason'], REASON_MAX);
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

async function completeReformulation(input: CompleteJsonInput): Promise<Record<string, unknown>> {
  const keys = readStoredAiCredentials().keys;
  return runWithKeyFallback(keys, (provider, credentials) =>
    completeJson(provider, input, credentials),
  );
}

/** Suggest other wordings. Grammar and spelling are left to the correction pass. */
export async function suggestReformulations(
  request: SuggestReformulationsInput,
): Promise<{ source: string; suggestions: ReformulationSuggestion[] }> {
  const source = clip(request.text, TEXT_MAX);
  const lemma = clip(request.lemma, LEMMA_MAX);
  if (!source) return { source: '', suggestions: [] };
  const language = languageName(request.language);
  const input: CompleteJsonInput = {
    system: reformulateSystemPrompt(language, !!lemma),
    user: buildUserMessage(request, source),
    maxTokens: REFORMULATE_MAX_TOKENS,
    temperature: 0,
  };
  try {
    const complete = () => completeReformulation(input);
    let suggestions = parseSuggestions(await complete(), source);
    if (!suggestions) suggestions = parseSuggestions(await complete(), source);
    if (!suggestions) aiError(AI_ERROR.RESPONSE_INVALID);
    return { source, suggestions };
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
