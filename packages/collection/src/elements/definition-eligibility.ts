import { parsePassage } from './element-store';
import { compileFormSources } from './forms';

type ElementForms = {
  title: string;
  definitions: readonly { forms: readonly { text: string }[] }[];
};

function surfaceForms(element: ElementForms): string[] {
  return element.definitions.flatMap((definition) => definition.forms.map((form) => form.text));
}

function lemmaFormsPattern(lemma: string, forms: readonly string[]): string {
  const parts = compileFormSources([lemma, ...forms]);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `(?:${parts.join('|')})`;
}

/** One match of the lemma or a form. `surface` is the exact substring. */
export type SurfaceSpan = {
  start: number;
  end: number;
  surface: string;
};

/**
 * Non-overlapping matches of the lemma or a form, in order.
 * Matching uses the same word boundaries as form highlighting.
 */
export function surfaceSpans(
  text: string,
  lemma: string,
  forms: readonly string[] = [],
): SurfaceSpan[] {
  const pattern = text ? lemmaFormsPattern(lemma, forms) : '';
  if (!pattern) return [];
  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, 'giu');
  } catch {
    return [];
  }
  const found: SurfaceSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    if (match[0]) {
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        surface: match[0],
      });
    }
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return found;
}

/**
 * Words in a gloss that are the element or one of its forms.
 * Matching uses the same word boundaries as form highlighting.
 */
export function definitionSelfMentions(
  gloss: string,
  lemma: string,
  forms: readonly string[] = [],
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const span of surfaceSpans(gloss.trim(), lemma, forms)) {
    const surface = span.surface.replace(/\s+/g, ' ').trim();
    const key = surface.toLocaleLowerCase();
    if (!surface || seen.has(key)) continue;
    seen.add(key);
    found.push(surface);
  }
  return found;
}

function quoteList(mentions: readonly string[]): string {
  const quoted = mentions.map((word) => `“${word}”`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}

/** Empty when the gloss does not name the element or a form. */
export function definitionSelfMentionWarning(mentions: readonly string[]): string {
  if (!mentions.length) return '';
  return `Remove ${quoteList(mentions)} from this definition, or this definition is not eligible for games.`;
}

export function definitionSelfMentionsFor(text: string, element: ElementForms): string[] {
  return definitionSelfMentions(parsePassage(text).text, element.title, surfaceForms(element));
}

export function definitionSelfMentionWarningFor(text: string, element: ElementForms): string {
  return definitionSelfMentionWarning(definitionSelfMentionsFor(text, element));
}

/** A gloss can be a game prompt when it does not name the element or a form. */
export function definitionEligibleForGames(text: string, element: ElementForms): boolean {
  return definitionSelfMentionsFor(text, element).length === 0;
}

/** True when any definition names the element or one of its forms. */
export function elementHasInvalidDefinition(element: {
  title: string;
  definitions: readonly { text: string; forms: readonly { text: string }[] }[];
}): boolean {
  return element.definitions.some(
    (definition) => !definitionEligibleForGames(definition.text, element),
  );
}
