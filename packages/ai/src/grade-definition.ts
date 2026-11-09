import { TRANSLATION_GEM_MAX, languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const GRADE_DEFINITION_SYSTEM_PROMPT = `You compare a learner's definition to the stored dictionary gloss for one sense.
JSON keys stay in English.
The answer and the gloss are both in the language named by writeFieldsIn.
Score gems from 0 to ${TRANSLATION_GEM_MAX}. Judge meaning, not wording.
- ${TRANSLATION_GEM_MAX} means the same sense, with acceptable wording
- Partial credit means the right sense with missing or extra detail
- 0 means a different sense, or unrelated
Spelling mistakes do not sink a correct meaning.
explanation MUST be in the language named by writeFieldsIn. Do not write it in English unless writeFieldsIn is English.
explanation says why the score is what it is. Do not quote the stored gloss in full.
JSON only: {"score":<0-${TRANSLATION_GEM_MAX}>,"explanation":"<text>"}`;

const GRADE_MAX_TOKENS = 1024;

export type GradeDefinitionInput = {
  language: string;
  lemma: string;
  gloss: string;
  answer: string;
};

export type GradedDefinition = {
  score: number;
  explanation: string;
};

export function buildGradeDefinitionUserMessage(input: GradeDefinitionInput): string {
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
export function parseGradedDefinition(parsed: unknown): GradedDefinition | null {
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

/** Ask the saved model how close a definition is to the stored gloss. */
export async function gradeDefinition(request: GradeDefinitionInput): Promise<GradedDefinition> {
  const language = String(request.language || '')
    .trim()
    .toLowerCase();
  const lemma = String(request.lemma || '').trim();
  const gloss = String(request.gloss || '').trim();
  const answer = String(request.answer || '').trim();
  if (!language || !lemma || !gloss || !answer) aiError(AI_ERROR.RESPONSE_INVALID);
  const ready: GradeDefinitionInput = { language, lemma, gloss, answer };
  const input: CompleteJsonInput = {
    system: GRADE_DEFINITION_SYSTEM_PROMPT,
    user: buildGradeDefinitionUserMessage(ready),
    maxTokens: GRADE_MAX_TOKENS,
    temperature: 0,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let grade = parseGradedDefinition(await complete());
    if (!grade) grade = parseGradedDefinition(await complete());
    if (!grade) aiError(AI_ERROR.RESPONSE_INVALID);
    return grade;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
