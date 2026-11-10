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

export const REFORMULATE_EXAMPLE_SYSTEM_PROMPT = `You propose more natural wordings of one learner sentence.
JSON keys stay in English.
text is in the language named by writeFieldsIn.
Every option MUST be in that same language. Do not translate it.
Offer exactly 3 different ways to say the same thing more naturally.
Keep the meaning. Do not add facts that were not in text.
lemma is the headword and forms lists its forms for this sense. A form may be a pattern.
Do not add the lemma or a form if text did not already contain that word.
If text already contains one, keep that same word in every option.
The options are proposals. Do not pick one for the learner.
JSON only: {"options":["<wording>","<wording>","<wording>"]}`;

const POLISH_MAX_TOKENS = 1024;
const REFORMULATE_OPTION_COUNT = 3;

export type PolishExampleTask = 'correct' | 'reformulate';

export type PolishExampleInput = {
  language: string;
  text: string;
  task: PolishExampleTask;
  lemma: string;
  forms: readonly string[];
};

export type CorrectedExample = {
  task: 'correct';
  text: string;
  explanation: string;
};

export type ReformulatedExample = {
  task: 'reformulate';
  options: string[];
};

export type PolishExampleResult = CorrectedExample | ReformulatedExample;

export function buildPolishExampleUserMessage(input: PolishExampleInput): string {
  const language = input.language.trim().toLowerCase();
  const body: Record<string, unknown> = {
    writeFieldsIn: languageDisplayName(language) || language,
    text: input.text.trim(),
  };
  if (input.task === 'reformulate') {
    body['lemma'] = input.lemma.trim();
    body['forms'] = input.forms.map((form) => form.trim()).filter(Boolean);
  }
  return JSON.stringify(body);
}

function readText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePolishedExample(
  parsed: unknown,
  task: PolishExampleTask,
): PolishExampleResult | null {
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

/** Correct spelling in a sentence, or propose three more natural wordings. */
export async function polishExample(request: PolishExampleInput): Promise<PolishExampleResult> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const text = String(request.text || '').trim();
  const task = request.task;
  if (!language || !text || (task !== 'correct' && task !== 'reformulate')) {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
  const ready: PolishExampleInput = {
    language,
    text,
    task,
    lemma: String(request.lemma || '').trim(),
    forms: (request.forms ?? []).map((form) => String(form || '').trim()).filter(Boolean),
  };
  const input: CompleteJsonInput = {
    system: task === 'reformulate' ? REFORMULATE_EXAMPLE_SYSTEM_PROMPT : CORRECT_EXAMPLE_SYSTEM_PROMPT,
    user: buildPolishExampleUserMessage(ready),
    maxTokens: POLISH_MAX_TOKENS,
    temperature: task === 'reformulate' ? 0.4 : 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let polished = parsePolishedExample(await complete(), task);
    if (!polished) polished = parsePolishedExample(await complete(), task);
    if (!polished) aiError(AI_ERROR.RESPONSE_INVALID);
    return polished;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
