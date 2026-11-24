import { languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const CORRECT_MAX_TOKENS = 1024;
const EVALUATE_MAX_TOKENS = 2048;
const ANSWER_MAX = 1000;
const FEEDBACK_MAX = 800;
const GLOSS_MAX = 400;
const EXAMPLE_MAX = 500;
const EQUIVALENT_MAX = 200;
const MISTAKE_MAX = 200;
const COVERAGE_MAX = 10;

const CORRECT_SYSTEM_PROMPT = `You correct grammar and spelling in one sentence a learner wrote.
JSON keys stay in English.
The sentence is in the language named by language.
Fix grammar and spelling only. Do not change the meaning. Do not add a fact, a definition, or a translation. Do not remove a meaning the learner stated.
corrected is the full sentence after those fixes. If nothing is wrong, repeat the sentence unchanged.
mistakes lists each change. wrote is the span they wrote. correction is what that span should be. If nothing is wrong, mistakes is an empty array.
JSON only: {"corrected":"<sentence>","mistakes":[{"wrote":"<span>","correction":"<span>"}]}`;

const EVALUATE_SYSTEM_PROMPT = `You score how completely a learner stated the meanings of one headword.
JSON keys stay in English.
The learner wrote answer in answerLang. feedback MUST be written in learningLang.
senses are the stored definitions of this headword. gloss is that sense in learningLang. equivalent, when present, is the headword's translation for that sense in answerLang.
coverage is an integer from 0 to 10.
Give 10 only when every stored sense is present in the answer and each one is close.
Lower the score when a stored sense is missing, vague, or only partly matched. Count how many senses are covered and how close each one is.
Give 0 when none of the stored senses are present.
extra is present only when the answer clearly states a real additional sense of this lemma. A paraphrase of a stored sense is not extra. Do not invent a sense the answer did not state.
extra.gloss is a short dictionary definition of that new sense, written in learningLang.
extra.example is one sentence in learningLang that uses the lemma and makes that new sense obvious.
When answerLang differs from learningLang, extra.equivalent is the headword's equivalent for that new sense in answerLang. Otherwise omit equivalent.
Omit extra entirely when there is no additional sense.
feedback comments on what was covered and how close it was. Write it in learningLang, as a natural sentence. Do not quote the stored definition, the learner's wording, or any phrase, and do not use quotation marks. Do not put the numeric score in feedback.
JSON only: {"coverage":0,"feedback":"<comment>","extra":{"gloss":"<definition>","example":"<sentence>","equivalent":"<headword>"}}`;

export type RecallSense = {
  gloss: string;
  equivalent?: string;
};

export type RecallExtra = {
  gloss: string;
  example: string;
  equivalent: string;
};

export type RecallEvaluation = {
  coverage: number;
  feedback: string;
  extra: RecallExtra | null;
};

export type RecallMistake = {
  wrote: string;
  correction: string;
};

export type RecallCorrection = {
  corrected: string;
  mistakes: RecallMistake[];
};

type CorrectRecallInput = {
  language: string;
  text: string;
};

type EvaluateRecallInput = {
  lemma: string;
  learningLanguage: string;
  answerLanguage: string;
  answer: string;
  senses: readonly RecallSense[];
};

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

function buildCorrectUserMessage(input: CorrectRecallInput): string {
  return JSON.stringify({
    language: languageName(input.language),
    text: clip(input.text, ANSWER_MAX),
  });
}

function buildEvaluateUserMessage(input: EvaluateRecallInput): string {
  const learning = languageName(input.learningLanguage);
  const answer = languageName(input.answerLanguage);
  return JSON.stringify({
    lemma: clip(input.lemma, 200),
    learningLang: learning,
    answerLang: answer,
    answer: clip(input.answer, ANSWER_MAX),
    senses: input.senses.map((sense) => {
      const gloss = clip(sense.gloss, GLOSS_MAX);
      const equivalent = clip(sense.equivalent, EQUIVALENT_MAX);
      return equivalent ? { gloss, equivalent } : { gloss };
    }),
  });
}

function parseCorrection(parsed: unknown): RecallCorrection | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const corrected = clip(source['corrected'], ANSWER_MAX);
  if (!corrected) return null;
  const list = source['mistakes'];
  const mistakes: RecallMistake[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const wrote = clip(row['wrote'], MISTAKE_MAX);
      const correction = clip(row['correction'], MISTAKE_MAX);
      if (!wrote || !correction || wrote.toLowerCase() === correction.toLowerCase()) continue;
      mistakes.push({ wrote, correction });
    }
  }
  return { corrected, mistakes };
}

function parseExtra(
  value: unknown,
  senses: readonly RecallSense[],
  sameLanguage: boolean,
): RecallExtra | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const gloss = clip(source['gloss'], GLOSS_MAX);
  if (!gloss) return null;
  const known = gloss.toLowerCase();
  if (senses.some((sense) => sense.gloss.trim().toLowerCase() === known)) return null;
  const example = clip(source['example'], EXAMPLE_MAX);
  const equivalent = sameLanguage ? '' : clip(source['equivalent'], EQUIVALENT_MAX);
  return { gloss, example, equivalent };
}

function parseEvaluation(
  parsed: unknown,
  senses: readonly RecallSense[],
  sameLanguage: boolean,
): RecallEvaluation | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const coverage = Math.round(Number(source['coverage']));
  if (!Number.isInteger(coverage) || coverage < 0 || coverage > COVERAGE_MAX) return null;
  const feedback = clip(source['feedback'], FEEDBACK_MAX);
  if (!feedback) return null;
  return {
    coverage,
    feedback,
    extra: parseExtra(source['extra'], senses, sameLanguage),
  };
}

async function completeRecall(input: CompleteJsonInput): Promise<Record<string, unknown>> {
  const keys = readStoredAiCredentials().keys;
  return runWithKeyFallback(keys, (provider, credentials) =>
    completeJson(provider, input, credentials),
  );
}

/** Repair grammar and spelling. The stored meanings are not part of this request. */
export async function correctRecallAnswer(request: CorrectRecallInput): Promise<RecallCorrection> {
  const text = clip(request.text, ANSWER_MAX);
  if (!text) return { corrected: '', mistakes: [] };
  const input: CompleteJsonInput = {
    system: CORRECT_SYSTEM_PROMPT,
    user: buildCorrectUserMessage({ ...request, text }),
    maxTokens: CORRECT_MAX_TOKENS,
    temperature: 0,
  };
  try {
    const complete = () => completeRecall(input);
    let correction = parseCorrection(await complete());
    if (!correction) correction = parseCorrection(await complete());
    if (!correction) aiError(AI_ERROR.RESPONSE_INVALID);
    return correction;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}

/** Score how many stored senses the answer covers, and how close it is. */
export async function evaluateRecallAnswer(
  request: EvaluateRecallInput,
): Promise<RecallEvaluation> {
  const answer = clip(request.answer, ANSWER_MAX);
  const senses = request.senses.filter((sense) => clip(sense.gloss, GLOSS_MAX));
  if (!answer || !senses.length) {
    return { coverage: 0, feedback: '', extra: null };
  }
  const sameLanguage =
    request.learningLanguage.trim().toLowerCase() === request.answerLanguage.trim().toLowerCase();
  const input: CompleteJsonInput = {
    system: EVALUATE_SYSTEM_PROMPT,
    user: buildEvaluateUserMessage({ ...request, answer, senses }),
    maxTokens: EVALUATE_MAX_TOKENS,
    temperature: 0,
  };
  try {
    const complete = () => completeRecall(input);
    let evaluation = parseEvaluation(await complete(), senses, sameLanguage);
    if (!evaluation) evaluation = parseEvaluation(await complete(), senses, sameLanguage);
    if (!evaluation) aiError(AI_ERROR.RESPONSE_INVALID);
    return evaluation;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
