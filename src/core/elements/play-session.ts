import { formMatchesTerm, surfaceSpans, type StoredElement } from 'collection';
import type { GradedDefinition, GradedEquivalent } from 'ai';

export const EQUIVALENT_MAX = 200;
export const RECALL_MAX = 200;
export const DEFINITION_MAX = 500;

export type AnswerLanguage = 'original' | 'english';

/** The learner's own call on an equivalent they just wrote. */
export type EquivalentVerdict = 'got' | 'miss';

export type PlayRound = {
  equivalentDrafts: string[];
  equivalentSubmitted: boolean[];
  equivalentVerdicts: Array<EquivalentVerdict | null>;
  equivalentGrades: Array<GradedEquivalent | null>;
  recall: string;
  recalled: boolean;
  revealedCount: number;
  definitionDrafts: string[];
  definitionLanguages: AnswerLanguage[];
  grades: Array<GradedDefinition | null>;
  definitionTranslations: string[];
  /** The learner stopped this round. The card is shown again. */
  givenUp: boolean;
};

export function emptyPlayRound(): PlayRound {
  return {
    equivalentDrafts: [],
    equivalentSubmitted: [],
    equivalentVerdicts: [],
    equivalentGrades: [],
    recall: '',
    recalled: false,
    revealedCount: 0,
    definitionDrafts: [],
    definitionLanguages: [],
    grades: [],
    definitionTranslations: [],
    givenUp: false,
  };
}

export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    );
  }
  return Array.from(text);
}

/** How many graphemes to show so the cue uncovers one more letter. */
export function nextLetterCount(chars: readonly string[], from: number): number {
  let index = from;
  while (index < chars.length) {
    index += 1;
    if (/\p{L}/u.test(chars[index - 1] ?? '')) return index;
  }
  return from;
}

export function matchesElement(answer: string, element: StoredElement): boolean {
  const text = answer.trim();
  if (!text) return false;
  if (sameSurface(text, element.title) || formMatchesTerm(element.title, text)) return true;
  return element.definitions.some((definition) =>
    definition.forms.some(
      (form) => sameSurface(text, form.text) || formMatchesTerm(form.text, text),
    ),
  );
}

function sameSurface(left: string, right: string): boolean {
  return normalizeSurface(left) === normalizeSurface(right);
}

function normalizeSurface(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

type SurfacePart = { kind: 'text'; text: string } | { kind: 'blur'; text: string };

function blurredParts(sentence: string, element: StoredElement): SurfacePart[] {
  const forms = element.definitions.flatMap((definition) =>
    definition.forms.map((form) => form.text),
  );
  const spans = surfaceSpans(sentence, element.title, forms);
  if (!spans.length) return [{ kind: 'text', text: sentence }];
  const parts: SurfacePart[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) parts.push({ kind: 'text', text: sentence.slice(cursor, span.start) });
    parts.push({ kind: 'blur', text: span.surface });
    cursor = span.end;
  }
  if (cursor < sentence.length) parts.push({ kind: 'text', text: sentence.slice(cursor) });
  return parts;
}

/** True when this text contains the title or one of its forms. */
export function textNamesElement(text: string, element: StoredElement): boolean {
  const forms = element.definitions.flatMap((definition) =>
    definition.forms.map((form) => form.text),
  );
  return surfaceSpans(text, element.title, forms).length > 0;
}

/** The element's own words become an ellipsis so speech does not say the answer. */
export function maskedSentence(sentence: string, element: StoredElement): string {
  return blurredParts(sentence, element)
    .map((part) => (part.kind === 'text' ? part.text : '…'))
    .join('');
}
