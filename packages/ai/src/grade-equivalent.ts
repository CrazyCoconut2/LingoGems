import { TRANSLATION_GEM_MAX, languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const GRADE_EQUIVALENT_SYSTEM_PROMPT = `You judge whether a word a learner wrote applies to one dictionary sense.
JSON keys stay in English.
answer is the learner's word or phrase. Read it in the language it is written in, which may differ from writeFieldsIn.
definition is the sense, in the language named by writeFieldsIn.
lemma is the headword of that sense, also in writeFieldsIn.
Score gems from 0 to ${TRANSLATION_GEM_MAX} for how well answer applies to this definition.
- ${TRANSLATION_GEM_MAX} means answer names this sense
- Partial credit means a nearby sense, or the right sense with the wrong specificity
- 0 means a different sense, or unrelated
Spelling mistakes do not sink a correct meaning.
explanation MUST be in the language named by writeFieldsIn. Do not write it in English unless writeFieldsIn is English.
explanation says whether the written word applies to the definition and why the score is what it is. Do not quote the definition in full.
JSON only: {"score":<0-${TRANSLATION_GEM_MAX}>,"explanation":"<text>"}`;

const GRADE_MAX_TOKENS = 1024;

export type GradeEquivalentInput = {
  language: string;
  lemma: string;
  definition: string;
  answer: string;
};

export type GradedEquivalent = {
  score: number;
  explanation: string;
};

export function buildGradeEquivalentUserMessage(input: GradeEquivalentInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  return JSON.stringify({
    writeFieldsIn,
    lemma: input.lemma.trim(),
    definition: input.definition.trim(),
    answer: input.answer.trim(),
  });
}

/** A clamped score and an explanation, or null when the reply is unusable. */
export function parseGradedEquivalent(parsed: unknown): GradedEquivalent | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source || !('score' in source)) return null;
  const raw = source['score'];
  const score =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(score)) return null;
  const explanation = String(source['explanation'] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!explanation) return null;
  return {
    score: Math.min(TRANSLATION_GEM_MAX, Math.max(0, Math.round(score))),
    explanation,
  };
}

/** Ask whether the word the learner wrote applies to this sense. */
export async function gradeEquivalent(request: GradeEquivalentInput): Promise<GradedEquivalent> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const lemma = String(request.lemma || '').trim();
  const definition = String(request.definition || '').trim();
  const answer = String(request.answer || '').trim();
  if (!language || !lemma || !definition || !answer) aiError(AI_ERROR.RESPONSE_INVALID);
  const ready: GradeEquivalentInput = { language, lemma, definition, answer };
  const input: CompleteJsonInput = {
    system: GRADE_EQUIVALENT_SYSTEM_PROMPT,
    user: buildGradeEquivalentUserMessage(ready),
    maxTokens: GRADE_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let grade = parseGradedEquivalent(await complete());
    if (!grade) grade = parseGradedEquivalent(await complete());
    if (!grade) aiError(AI_ERROR.RESPONSE_INVALID);
    return grade;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
