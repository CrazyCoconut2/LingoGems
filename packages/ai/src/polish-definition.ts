import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const POLISH_DEFINITION_SYSTEM_PROMPT = `You rewrite one learner definition.
JSON keys stay in English.
text is in the language named by writeFieldsIn.
Reply with text in that same language. Do not translate it.
task is correct or reformulate.
- correct fixes spelling and grammar and keeps the wording
- reformulate says the same thing more naturally
Do not add facts that were not in text.
JSON only: {"text":"<rewritten definition>"}`;

const POLISH_MAX_TOKENS = 512;

export type PolishDefinitionTask = 'correct' | 'reformulate';

export type PolishDefinitionInput = {
  language: string;
  text: string;
  task: PolishDefinitionTask;
};

export function buildPolishDefinitionUserMessage(input: PolishDefinitionInput): string {
  const language = input.language.trim().toLowerCase();
  return JSON.stringify({
    writeFieldsIn: languageDisplayName(language) || language,
    task: input.task,
    text: input.text.trim(),
  });
}

export function parsePolishedDefinition(parsed: unknown): string | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const text = String(source?.['text'] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Correct a definition, or say it more naturally, in its own language. */
export async function polishDefinition(request: PolishDefinitionInput): Promise<string> {
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
    system: POLISH_DEFINITION_SYSTEM_PROMPT,
    user: buildPolishDefinitionUserMessage(ready),
    maxTokens: POLISH_MAX_TOKENS,
    temperature: task === 'reformulate' ? 0.4 : 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let polished = parsePolishedDefinition(await complete());
    if (!polished) polished = parsePolishedDefinition(await complete());
    if (!polished) aiError(AI_ERROR.RESPONSE_INVALID);
    return polished;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
