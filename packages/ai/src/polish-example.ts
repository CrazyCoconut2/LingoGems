import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const CORRECT_EXAMPLE_SYSTEM_PROMPT = `You correct spelling in one learner sentence.
JSON keys stay in English.
text is in the language named by writeFieldsIn.
text and explanation MUST be in that same language. Do not translate text.
Fix only spelling, accents, and typos.
Do not change grammar, word order, word choice, or meaning.
Do not add words, remove words, or insert a word that was not already in text.
explanation names each spelling error. If there were none, say it was already correct.
JSON only: {"text":"<corrected sentence>","explanation":"<what was wrong>"}`;

const POLISH_MAX_TOKENS = 1024;

export type PolishExampleInput = {
  language: string;
  text: string;
};

export type CorrectedExample = {
  text: string;
  explanation: string;
};

export function buildPolishExampleUserMessage(input: PolishExampleInput): string {
  const language = input.language.trim().toLowerCase();
  return JSON.stringify({
    writeFieldsIn: languageDisplayName(language) || language,
    text: input.text.trim(),
  });
}

function readText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePolishedExample(parsed: unknown): CorrectedExample | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const text = readText(source['text']);
  const explanation = readText(source['explanation']);
  if (!text || !explanation) return null;
  return { text, explanation };
}

/** Fix spelling, accents, and typos. Wording and meaning stay as written. */
export async function polishExample(request: PolishExampleInput): Promise<CorrectedExample> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const text = String(request.text || '').trim();
  if (!language || !text) aiError(AI_ERROR.RESPONSE_INVALID);
  const ready: PolishExampleInput = { language, text };
  const input: CompleteJsonInput = {
    system: CORRECT_EXAMPLE_SYSTEM_PROMPT,
    user: buildPolishExampleUserMessage(ready),
    maxTokens: POLISH_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let polished = parsePolishedExample(await complete());
    if (!polished) polished = parsePolishedExample(await complete());
    if (!polished) aiError(AI_ERROR.RESPONSE_INVALID);
    return polished;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
