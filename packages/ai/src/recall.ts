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
const MISTAKE_MAX = 300;
const SPAN_MAX = 200;
const PRIOR_MAX = 20;
const ID_MAX = 80;
const COVERAGE_MAX = 10;

function correctSystemPrompt(hasPrior: boolean, language: string): string {
  const lines = [
    'You correct grammar and spelling in one sentence a learner wrote.',
    'JSON keys stay in English. The rule text does not.',
    `The sentence is in ${language}.`,
    'Fix grammar and spelling only. Do not change the meaning. Do not add a fact, a definition, or a translation. Do not remove a meaning the learner stated.',
    'corrected is the full sentence after those fixes. If nothing is wrong, repeat the sentence unchanged.',
    `committed lists each general rule broken in this sentence. rule names the pattern, not the words the learner wrote and not the corrected words. The same pattern in another sentence is the same rule. rule MUST be written in ${language}. A French sentence gets a French rule. An English sentence gets an English rule. Do not write rule in English unless ${language} is English. wrote is the exact span in the learner sentence that breaks this rule, and no other mistake. correction is what that span should be. wrote appears in the learner sentence. correction appears in corrected. When the same rule is broken in more than one place, repeat that rule once for each span. If nothing is wrong, committed is an empty array.`,
  ];
  if (hasPrior) {
    lines.push(
      'priorMistakes are rules this learner has broken before. id identifies one rule. rule is that general rule.',
      'When this sentence breaks one of those rules again, committed includes that id. When the rule is new, omit id.',
      'resolved lists each prior rule this sentence follows. id is that rule. wrote is the exact span in the learner sentence that follows the rule. An id belongs there only when the sentence itself follows that rule. Leave a rule out when the sentence still breaks it, or when the sentence does not involve that pattern.',
      'An id is never both committed and resolved.',
    );
  }
  const shape = hasPrior
    ? `{"corrected":"<sentence>","committed":[{"id":"<id>","rule":"<rule in ${language}>","wrote":"<span>","correction":"<span>"}],"resolved":[{"id":"<id>","wrote":"<span that follows the rule>"}]}`
    : `{"corrected":"<sentence>","committed":[{"rule":"<rule in ${language}>","wrote":"<span>","correction":"<span>"}],"resolved":[]}`;
  lines.push(`JSON only: ${shape}`);
  return lines.join('\n');
}

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
When answerLang differs from learningLang, do not include a translation or an equivalent. The learner asks for those separately.
Omit extra entirely when there is no additional sense.
feedback comments on what was covered and how close it was. Write it in learningLang, as a natural sentence. Do not quote the stored definition, the learner's wording, or any phrase, and do not use quotation marks. Do not put the numeric score in feedback.
JSON only: {"coverage":0,"feedback":"<comment>","extra":{"gloss":"<definition>","example":"<sentence>"}}`;

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
  rule: string;
};

export type RecallPriorMistake = {
  id: string;
  rule: string;
};

export type RecallCommittedMistake = {
  /** Prior rule id when this sentence breaks that rule again. Empty when the rule is new. */
  id: string;
  rule: string;
  /** Exact span in the learner sentence that breaks this rule. */
  wrote: string;
  /** What that span should be. */
  correction: string;
};

export type RecallResolvedMistake = {
  id: string;
  /** Exact span in the learner sentence that follows this rule. */
  wrote: string;
};

export type RecallCorrection = {
  corrected: string;
  mistakes: RecallMistake[];
  committed: RecallCommittedMistake[];
  /** Prior rules this sentence followed, with the span that followed each one. */
  resolved: RecallResolvedMistake[];
};

type CorrectRecallInput = {
  language: string;
  text: string;
  priorMistakes?: readonly RecallPriorMistake[];
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
  const priorMistakes = priorMistakesOf(input.priorMistakes);
  return JSON.stringify({
    language: languageName(input.language),
    text: clip(input.text, ANSWER_MAX),
    ...(priorMistakes.length ? { priorMistakes } : {}),
  });
}

function priorMistakesOf(
  mistakes: readonly RecallPriorMistake[] | undefined,
): RecallPriorMistake[] {
  const seen = new Set<string>();
  const rows: RecallPriorMistake[] = [];
  for (const mistake of mistakes ?? []) {
    const id = clip(mistake.id, ID_MAX);
    const rule = clip(mistake.rule, MISTAKE_MAX);
    if (!id || !rule || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, rule });
    if (rows.length >= PRIOR_MAX) break;
  }
  return rows;
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

function parseCorrection(parsed: unknown, priorIds: ReadonlySet<string>): RecallCorrection | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!source) return null;
  const corrected = clip(source['corrected'], ANSWER_MAX);
  if (!corrected) return null;
  const committed = parseCommitted(source['committed'], priorIds);
  const committedIds = new Set(committed.flatMap((item) => (item.id ? [item.id] : [])));
  return {
    corrected,
    mistakes: committed.map((item) => ({ rule: item.rule })),
    committed,
    resolved: parseResolved(source['resolved'], priorIds, committedIds),
  };
}

function parseCommitted(value: unknown, priorIds: ReadonlySet<string>): RecallCommittedMistake[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const commits: RecallCommittedMistake[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const rule = clip(row['rule'], MISTAKE_MAX);
    if (!rule) continue;
    const wrote = clip(row['wrote'], SPAN_MAX);
    const correction = clip(row['correction'], SPAN_MAX);
    const span =
      wrote && correction && wrote.toLowerCase() !== correction.toLowerCase()
        ? { wrote, correction }
        : { wrote: '', correction: '' };
    const rawId = clip(row['id'], ID_MAX);
    const id = rawId && priorIds.has(rawId) ? rawId : '';
    const key = `${id || rule.toLowerCase()}\n${span.wrote.toLowerCase()}\n${span.correction.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commits.push({ id, rule, wrote: span.wrote, correction: span.correction });
  }
  return commits;
}

function parseResolved(
  value: unknown,
  priorIds: ReadonlySet<string>,
  committedIds: ReadonlySet<string>,
): RecallResolvedMistake[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: RecallResolvedMistake[] = [];
  for (const item of value) {
    const id = clip(typeof item === 'string' ? item : idOf(item), ID_MAX);
    const wrote =
      item && typeof item === 'object' && !Array.isArray(item)
        ? clip((item as Record<string, unknown>)['wrote'], SPAN_MAX)
        : '';
    if (!id || !priorIds.has(id) || committedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, wrote });
  }
  return rows;
}

function idOf(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return String((value as Record<string, unknown>)['id'] ?? '');
}

function parseExtra(value: unknown, senses: readonly RecallSense[]): RecallExtra | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const gloss = clip(source['gloss'], GLOSS_MAX);
  if (!gloss) return null;
  const known = gloss.toLowerCase();
  if (senses.some((sense) => sense.gloss.trim().toLowerCase() === known)) return null;
  const example = clip(source['example'], EXAMPLE_MAX);
  return { gloss, example, equivalent: '' };
}

function parseEvaluation(parsed: unknown, senses: readonly RecallSense[]): RecallEvaluation | null {
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
    extra: parseExtra(source['extra'], senses),
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
  const priorMistakes = priorMistakesOf(request.priorMistakes);
  const language = languageName(request.language);
  if (!text) return { corrected: '', mistakes: [], committed: [], resolved: [] };
  const input: CompleteJsonInput = {
    system: correctSystemPrompt(priorMistakes.length > 0, language),
    user: buildCorrectUserMessage({ ...request, text, priorMistakes }),
    maxTokens: CORRECT_MAX_TOKENS,
    temperature: 0,
  };
  const priorIds = new Set(priorMistakes.map((mistake) => mistake.id));
  try {
    const complete = () => completeRecall(input);
    let correction = parseCorrection(await complete(), priorIds);
    if (!correction) correction = parseCorrection(await complete(), priorIds);
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
  const input: CompleteJsonInput = {
    system: EVALUATE_SYSTEM_PROMPT,
    user: buildEvaluateUserMessage({ ...request, answer, senses }),
    maxTokens: EVALUATE_MAX_TOKENS,
    temperature: 0,
  };
  try {
    const complete = () => completeRecall(input);
    let evaluation = parseEvaluation(await complete(), senses);
    if (!evaluation) evaluation = parseEvaluation(await complete(), senses);
    if (!evaluation) aiError(AI_ERROR.RESPONSE_INVALID);
    return evaluation;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
