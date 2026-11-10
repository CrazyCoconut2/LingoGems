import { TRANSLATION_GEM_MAX, languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const GRADE_EXAMPLE_SYSTEM_PROMPT = `You score how well a learner's example shows one dictionary sense.
JSON keys stay in English.
The sentence and the gloss are both in the language named by writeFieldsIn.
lemma is the headword. The sentence already contains it or one of its forms. Do not score whether the word is present.
Score gems from 0 to ${TRANSLATION_GEM_MAX} for whether the rest of the sentence shows that the learner used the word in the sense of the gloss.
- ${TRANSLATION_GEM_MAX} means the other words make this sense clear. Someone who did not know the lemma could tell what it means here
- Partial credit means the sense is only partly shown, or the context is thin but still real
- 0 means the sentence does not show the sense. The lemma alone scores 0. The lemma with only a function word, such as an article, also scores 0. A different sense scores 0
Spelling mistakes do not sink a sentence that shows the sense.
explanation MUST be in the language named by writeFieldsIn. Do not write it in English unless writeFieldsIn is English.
explanation says whether the sentence shows this sense and why the score is what it is. Do not quote the gloss in full.
JSON only: {"score":<0-${TRANSLATION_GEM_MAX}>,"explanation":"<text>"}`;

const GRADE_MAX_TOKENS = 1024;

export type GradeExampleInput = {
  language: string;
  lemma: string;
  gloss: string;
  answer: string;
};

export type GradedExample = {
  score: number;
  explanation: string;
};

export function buildGradeExampleUserMessage(input: GradeExampleInput): string {
  const language = input.language.trim().toLowerCase();
  const writeFieldsIn = languageDisplayName(language) || language;
  return JSON.stringify({
    writeFieldsIn,
    lemma: input.lemma.trim(),
    gloss: input.gloss.trim(),
    answer: input.answer.trim(),
  });
}

/** A clamped score and an explanation, or null when the reply is unusable. */
export function parseGradedExample(parsed: unknown): GradedExample | null {
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

/** Ask the saved model how well an example uses one sense. */
export async function gradeExample(request: GradeExampleInput): Promise<GradedExample> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const lemma = String(request.lemma || '').trim();
  const gloss = String(request.gloss || '').trim();
  const answer = String(request.answer || '').trim();
  if (!language || !lemma || !gloss || !answer) aiError(AI_ERROR.RESPONSE_INVALID);
  const ready: GradeExampleInput = { language, lemma, gloss, answer };
  const input: CompleteJsonInput = {
    system: GRADE_EXAMPLE_SYSTEM_PROMPT,
    user: buildGradeExampleUserMessage(ready),
    maxTokens: GRADE_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let grade = parseGradedExample(await complete());
    if (!grade) grade = parseGradedExample(await complete());
    if (!grade) aiError(AI_ERROR.RESPONSE_INVALID);
    return grade;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
