import { compileFormSources } from './forms';

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
