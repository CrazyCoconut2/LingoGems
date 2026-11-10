import { TRANSLATION_GEM_MAX, languageDisplayName } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

export const GRADE_EXAMPLE_SYSTEM_PROMPT = `You score a learner's example sentence for one dictionary sense.
JSON keys stay in English.
The sentence and the gloss are both in the language named by writeFieldsIn.
forms lists this sense's forms. A form may be a pattern. lemma is the headword.
formPresent says whether the sentence already contains the lemma or one of those forms. Trust formPresent. Do not decide that yourself, and do not look for pattern characters in the sentence.
Score gems from 0 to ${TRANSLATION_GEM_MAX}.
- When formPresent is false, the score MUST be 0
- ${TRANSLATION_GEM_MAX} means a form is present and the sentence clearly uses it in the sense of the gloss
- Partial credit means a form is present but the sense is weak, incomplete, or only partly the gloss
- 0 means no form, a different sense, or not an example
Spelling mistakes do not sink a fitting sentence.
explanation MUST be in the language named by writeFieldsIn. Do not write it in English unless writeFieldsIn is English.
explanation says whether a form is present and whether the sentence matches the gloss, and why the score is what it is. Do not quote the gloss in full.
JSON only: {"score":<0-${TRANSLATION_GEM_MAX}>,"explanation":"<text>"}`;

const GRADE_MAX_TOKENS = 1024;

export type GradeExampleInput = {
  language: string;
  lemma: string;
  forms: readonly string[];
  gloss: string;
  answer: string;
  formPresent: boolean;
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
    forms: input.forms.map((form) => form.trim()).filter(Boolean),
    gloss: input.gloss.trim(),
    answer: input.answer.trim(),
    formPresent: input.formPresent,
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
  const forms = (request.forms ?? []).map((form) => String(form || '').trim()).filter(Boolean);
  if (!language || !lemma || !gloss || !answer) aiError(AI_ERROR.RESPONSE_INVALID);
  const ready: GradeExampleInput = {
    language,
    lemma,
    forms,
    gloss,
    answer,
    formPresent: request.formPresent === true,
  };
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
