import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const POLISH_DEFINITION_SYSTEM_PROMPT = `You correct one learner definition.
JSON keys stay in English.
text is in the language named by writeFieldsIn.
text and explanation MUST be in that same language. Do not translate text.
Fix spelling and grammar and keep the wording.
explanation names each error in the original, such as spelling, grammar, agreement, or accents. If there were none, say it was already correct.
Do not add facts that were not in text.
JSON only: {"text":"<corrected definition>","explanation":"<what was wrong>"}`;

export const REFORMULATE_DEFINITION_SYSTEM_PROMPT = `You propose more natural wordings of one learner definition.
JSON keys stay in English.
text is in the language named by writeFieldsIn.
Every option MUST be in that same language. Do not translate it.
Offer exactly 3 different ways to say the same thing more naturally.
Keep the meaning. Do not add facts that were not in text.
If the original is correct but uncommon, prefer the more common wording.
The options are proposals. Do not pick one for the learner.
JSON only: {"options":["<wording>","<wording>","<wording>"]}`;

const POLISH_MAX_TOKENS = 1024;
const REFORMULATE_OPTION_COUNT = 3;

export type PolishDefinitionTask = 'correct' | 'reformulate';

export type PolishDefinitionInput = {
  language: string;
  text: string;
  task: PolishDefinitionTask;
};

export type PolishedDefinition = {
  task: 'correct';
  text: string;
  explanation: string;
};

export type ReformulatedDefinition = {
  task: 'reformulate';
  options: string[];
};

export type PolishDefinitionResult = PolishedDefinition | ReformulatedDefinition;

export function buildPolishDefinitionUserMessage(input: PolishDefinitionInput): string {
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

export function parsePolishedDefinition(
  parsed: unknown,
  task: PolishDefinitionTask,
): PolishDefinitionResult | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  if (task === 'reformulate') {
    if (!Array.isArray(source['options'])) return null;
    const options: string[] = [];
    for (const option of source['options']) {
      const text = readText(option);
      if (!text || options.includes(text)) continue;
      options.push(text);
      if (options.length === REFORMULATE_OPTION_COUNT) break;
    }
    if (options.length < REFORMULATE_OPTION_COUNT) return null;
    return { task, options };
  }
  const text = readText(source['text']);
  const explanation = readText(source['explanation']);
  if (!text || !explanation) return null;
  return { task, text, explanation };
}

/** Correct a definition, or propose three more natural wordings, in its own language. */
export async function polishDefinition(
  request: PolishDefinitionInput,
): Promise<PolishDefinitionResult> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const text = String(request.text || '').trim();
  const task = request.task;
  if (!language || !text || (task !== 'correct' && task !== 'reformulate')) {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
  const ready: PolishDefinitionInput = { language, text, task };
  const input: CompleteJsonInput = {
    system: task === 'reformulate' ? REFORMULATE_DEFINITION_SYSTEM_PROMPT : POLISH_DEFINITION_SYSTEM_PROMPT,
    user: buildPolishDefinitionUserMessage(ready),
    maxTokens: POLISH_MAX_TOKENS,
    temperature: task === 'reformulate' ? 0.4 : 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let polished = parsePolishedDefinition(await complete(), task);
    if (!polished) polished = parsePolishedDefinition(await complete(), task);
    if (!polished) aiError(AI_ERROR.RESPONSE_INVALID);
    return polished;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
