import { compileFormSources } from './forms';
import { stickTrailingPunctuation } from './stick-punctuation';

export type DefinitionHighlightMatch = {
  elementId: string;
  title: string;
};

export type DefinitionHighlightPart = {
  text: string;
  /** True when this definition's title or forms won the span. */
  current: boolean;
  /** Other elements whose title or forms cover this span. */
  matches: DefinitionHighlightMatch[];
};

type HighlightRegex = { source: string; flags?: string };

type HighlightRule = {
  id: number;
  lemma: string;
  elementId: string | null;
  regexes: HighlightRegex[];
};

type HighlightSpan = {
  lemma: string;
  id: number;
  elementId: string | null;
};

type HighlightHit = {
  start: number;
  end: number;
  id: number;
  lemma: string;
  text: string;
  elementId: string | null;
  matches: HighlightSpan[];
};

const compiledRegexCache = new Map<string, RegExp | null>();
const CURRENT_ID = 0;

function toRegExp(regex: HighlightRegex): RegExp | null {
  const source = regex.source?.trim();
  if (!source) return null;
  const flags = new Set((regex.flags ?? '').split('').filter(Boolean));
  flags.add('g');
  flags.add('u');
  const flagKey = Array.from(flags).join('');
  const cacheKey = `${flagKey}\0${source}`;
  if (compiledRegexCache.has(cacheKey)) {
    const cached = compiledRegexCache.get(cacheKey) ?? null;
    if (cached) cached.lastIndex = 0;
    return cached;
  }
  try {
    const compiled = new RegExp(source, flagKey);
    compiledRegexCache.set(cacheKey, compiled);
    return compiled;
  } catch {
    compiledRegexCache.set(cacheKey, null);
    return null;
  }
}

/** Title or forms underline regex. Invalid forms are skipped. */
export function buildLemmaFormsRegex(lemma: string, forms: readonly string[]): string {
  const parts = compileFormSources([lemma, ...forms]);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `(?:${parts.join('|')})`;
}

function sameHighlightLemma(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function collectHighlightMatches(text: string, rules: readonly HighlightRule[]): HighlightHit[] {
  const matches: HighlightHit[] = [];
  for (const rule of rules) {
    for (const regex of rule.regexes) {
      const matcher = toRegExp(regex);
      if (!matcher) continue;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        matches.push({
          start,
          end,
          id: rule.id,
          lemma: rule.lemma,
          text: text.slice(start, end),
          elementId: rule.elementId,
          matches: [{ lemma: rule.lemma, id: rule.id, elementId: rule.elementId }],
        });
        if (match[0].length === 0) matcher.lastIndex += 1;
      }
    }
  }
  return matches;
}

function resolveHighlightOverlaps(matches: HighlightHit[]): HighlightHit[] {
  const sorted = [...matches].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const resolved: HighlightHit[] = [];
  for (const match of sorted) {
    const overlapping = resolved.filter(
      (existing) => match.start < existing.end && match.end > existing.start,
    );
    if (!overlapping.length) {
      resolved.push({ ...match, matches: match.matches.map((item) => ({ ...item })) });
      continue;
    }
    for (const existing of overlapping) {
      for (const item of match.matches) {
        if (existing.matches.some((kept) => sameHighlightLemma(kept.lemma, item.lemma))) continue;
        existing.matches.push({ ...item });
      }
    }
  }
  return resolved;
}

function ruleFor(
  id: number,
  title: string,
  forms: readonly string[],
  elementId: string,
): HighlightRule | null {
  const lemma = title.trim();
  if (!lemma) return null;
  const source = buildLemmaFormsRegex(lemma, forms);
  if (!source) return null;
  return { id, lemma, elementId, regexes: [{ source, flags: 'iu' }] };
}

function sameTitle(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/**
 * Highlight `text` with this definition's title and forms, then any other
 * element's title and that definition's forms. Forms stay on the definition
 * that owns them. Other elements are matched first, matching Linguagem, so an
 * equal overlap keeps the other element.
 */
export function highlightDefinitionPassage(
  text: string,
  current: { id: string; title: string; forms: readonly string[] },
  others: readonly { id: string; title: string; forms: readonly string[] }[],
): DefinitionHighlightPart[] {
  if (!text) return [];
  const rules: HighlightRule[] = [];
  let nextId = 1;
  for (const other of others) {
    if (!other.id || other.id === current.id || sameTitle(other.title, current.title)) continue;
    const rule = ruleFor(nextId, other.title, other.forms, other.id);
    if (!rule) continue;
    rules.push(rule);
    nextId += 1;
  }
  const currentRule = ruleFor(CURRENT_ID, current.title, current.forms, current.id);
  if (currentRule) rules.push(currentRule);
  if (!rules.length) return [{ text, current: false, matches: [] }];

  const hits = resolveHighlightOverlaps(collectHighlightMatches(text, rules));
  if (!hits.length) return [{ text, current: false, matches: [] }];
  hits.sort((left, right) => left.start - right.start);

  const parts: DefinitionHighlightPart[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      parts.push({ text: text.slice(cursor, hit.start), current: false, matches: [] });
    }
    const spans =
      hit.matches.length > 1
        ? hit.matches
        : [
            hit.matches[0] ?? {
              lemma: hit.lemma,
              id: hit.id,
              elementId: hit.elementId,
            },
          ];
    const seen = new Set<string>();
    const matches: DefinitionHighlightMatch[] = [];
    for (const span of spans) {
      if (!span.elementId || seen.has(span.elementId)) continue;
      seen.add(span.elementId);
      matches.push({ elementId: span.elementId, title: span.lemma });
    }
    parts.push({
      text: hit.text,
      current: hit.id === CURRENT_ID,
      matches,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), current: false, matches: [] });
  }

  return stickTrailingPunctuation(
    parts.map((part) => ({
      ...part,
      hit: part.current || part.matches.length > 0,
      lemma: part.current ? null : (part.matches[0]?.title ?? null),
    })),
  ).map(({ text: partText, current, matches }) => ({ text: partText, current, matches }));
}
