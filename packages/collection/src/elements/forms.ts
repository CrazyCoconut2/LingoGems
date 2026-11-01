/** Unicode letter/number/apostrophe/hyphen — same class as form underline boundaries. */
const WORD_CHAR = `[\\p{L}\\p{N}'’-]`;
const ANY_WORD = `${WORD_CHAR}+`;
const WILDCARD_ATOM_RE = /^[\p{L}\p{N}'’*-]+$/u;

type FormAtom = { type: 'exact'; value: string } | { type: 'wildcard'; value: string };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function interpretAtom(raw: string): FormAtom | null {
  const value = raw.trim();
  if (!value) return null;
  if (!value.includes('*')) return { type: 'exact', value };
  if (!WILDCARD_ATOM_RE.test(value)) return null;
  if (value !== '*' && !value.split('*').some(Boolean)) return null;
  return { type: 'wildcard', value };
}

function atomToRegex(atom: FormAtom): string {
  if (atom.type === 'exact') return escapeRegex(atom.value);
  return atom.value.split('*').map(escapeRegex).join(ANY_WORD);
}

function matchToRegex(atoms: FormAtom[]): string {
  const alts = atoms.map(atomToRegex);
  return alts.length === 1 ? alts[0]! : `(?:${alts.join('|')})`;
}

function parseGroup(source: string, start: number): { atoms: FormAtom[]; next: number } | null {
  if (source[start] !== '(') return null;
  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  const inner = source.slice(start + 1, i);
  if (!inner.trim()) return null;
  const atoms: FormAtom[] = [];
  for (const piece of inner.split('|')) {
    const trimmed = piece.trim();
    if (/\s/.test(trimmed)) return null;
    const atom = interpretAtom(trimmed);
    if (!atom) return null;
    atoms.push(atom);
  }
  if (!atoms.length) return null;
  return { atoms, next: i + 1 };
}

function parseBareAtom(source: string, start: number): { atoms: FormAtom[]; next: number } | null {
  let i = start;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch) || ch === '(' || ch === ')' || ch === '|') break;
    i += 1;
  }
  if (i === start) return null;
  const atom = interpretAtom(source.slice(start, i));
  if (!atom) return null;
  return { atoms: [atom], next: i };
}

function parseForm(source: string): FormAtom[][] | null {
  const input = source.trim();
  if (!input) return null;
  const parts: FormAtom[][] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i += 1;
    if (i >= input.length) break;
    const ch = input[i]!;
    if (ch === ')' || ch === '|') return null;
    const parsed = ch === '(' ? parseGroup(input, i) : parseBareAtom(input, i);
    if (!parsed) return null;
    parts.push(parsed.atoms);
    i = parsed.next;
  }
  return parts.length ? parts : null;
}

/** Compile one form to a highlight regex fragment, or null if invalid. */
export function compileForm(source: string): string | null {
  const parts = parseForm(source);
  if (!parts) return null;
  const body = parts.map(matchToRegex).join('\\s+');
  return body ? `(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})` : null;
}

export function isValidForm(source: string): boolean {
  return compileForm(source) !== null;
}

/** True when a form uses a wildcard or an alternation group. Exact words and phrases are regular. */
export function isPatternForm(source: string): boolean {
  return /[*()|]/.test(source);
}

/** True when `term` matches the compiled form. */
export function formMatchesTerm(form: string, term: string): boolean {
  const source = compileForm(form);
  const text = term.trim();
  if (!source || !text) return false;
  try {
    return new RegExp(source, 'iu').test(text);
  } catch {
    return false;
  }
}

/** Exact words a form contributes to the token prefilter. Wildcards are omitted. */
export function formExactTokens(source: string): string[] {
  const parts = parseForm(source);
  if (!parts) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const atoms of parts) {
    for (const atom of atoms) {
      if (atom.type !== 'exact') continue;
      const token = atom.value.trim().toLowerCase();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

const WORD_TOKEN_RE = /^[\p{L}\p{N}'’-]+$/u;
/** Same split the page highlighter uses. Keep in sync with highlight.js `textTokens`. */
const TEXT_SPLIT_RE = /[^\p{L}\p{N}\p{M}'’-]+/gu;
const EDGE_RE = /^['’-]+|['’-]+$/gu;

export type HighlightAffix = { prefix: string; suffix: string };

/**
 * Cheap signals for one lemma. A page text node can match only if one of these hits.
 * Word anchors are the longest exact word that every match of a form must contain,
 * so phrases are not indexed under short words like "a" or "de".
 */
export type HighlightProbes = {
  tokens: string[];
  prefixes: string[];
  suffixes: string[];
  contains: string[];
  literals: string[];
  affixes: HighlightAffix[];
  /** True when a form can match any word (`*`, or nothing selective). */
  always: boolean;
};

type ProbeBucket = {
  tokens: string[];
  prefixes: string[];
  suffixes: string[];
  contains: string[];
  literals: string[];
  affixes: HighlightAffix[];
  seenTokens: Set<string>;
  seenPrefixes: Set<string>;
  seenSuffixes: Set<string>;
  seenContains: Set<string>;
  seenLiterals: Set<string>;
  seenAffixes: Set<string>;
};

function emptyBucket(): ProbeBucket {
  return {
    tokens: [],
    prefixes: [],
    suffixes: [],
    contains: [],
    literals: [],
    affixes: [],
    seenTokens: new Set(),
    seenPrefixes: new Set(),
    seenSuffixes: new Set(),
    seenContains: new Set(),
    seenLiterals: new Set(),
    seenAffixes: new Set(),
  };
}

function remember(list: string[], seen: Set<string>, value: string): void {
  const token = value.trim().toLowerCase();
  if (!token || seen.has(token)) return;
  seen.add(token);
  list.push(token);
}

type WildcardConstraint =
  | { type: 'always' }
  | { type: 'prefix'; value: string }
  | { type: 'suffix'; value: string }
  | { type: 'affix'; prefix: string; suffix: string }
  | { type: 'contains'; value: string };

function wildcardConstraint(value: string): WildcardConstraint {
  const parts = value.split('*');
  if (parts.length < 2) return { type: 'always' };
  if (parts.length === 2) {
    const head = parts[0] ?? '';
    const tail = parts[1] ?? '';
    if (!head && !tail) return { type: 'always' };
    if (head && !tail) return { type: 'prefix', value: head };
    if (!head && tail) return { type: 'suffix', value: tail };
    return { type: 'affix', prefix: head, suffix: tail };
  }
  let longest = '';
  for (const part of parts) {
    if (part.length > longest.length) longest = part;
  }
  return longest ? { type: 'contains', value: longest } : { type: 'always' };
}

type GroupInfo =
  | { kind: 'open' }
  | { kind: 'anchor'; token: string; literal: boolean }
  | {
      kind: 'union';
      tokens: string[];
      literals: string[];
      prefixes: string[];
      suffixes: string[];
      contains: string[];
      affixes: HighlightAffix[];
    };

function analyzeGroup(group: FormAtom[]): GroupInfo {
  let open = false;
  const tokens: string[] = [];
  const literals: string[] = [];
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  const contains: string[] = [];
  const affixes: HighlightAffix[] = [];

  for (const atom of group) {
    if (atom.type === 'exact') {
      const value = atom.value.trim().toLowerCase();
      if (!value) continue;
      if (WORD_TOKEN_RE.test(value)) tokens.push(value);
      else literals.push(value);
      continue;
    }
    const constraint = wildcardConstraint(atom.value.trim().toLowerCase());
    if (constraint.type === 'always') {
      open = true;
      continue;
    }
    if (constraint.type === 'prefix') prefixes.push(constraint.value);
    else if (constraint.type === 'suffix') suffixes.push(constraint.value);
    else if (constraint.type === 'contains') contains.push(constraint.value);
    else affixes.push({ prefix: constraint.prefix, suffix: constraint.suffix });
  }

  if (open) return { kind: 'open' };
  const selective =
    tokens.length +
    literals.length +
    prefixes.length +
    suffixes.length +
    contains.length +
    affixes.length;
  if (selective === 0) return { kind: 'open' };
  if (tokens.length === 1 && selective === 1)
    return { kind: 'anchor', token: tokens[0]!, literal: false };
  if (literals.length === 1 && selective === 1)
    return { kind: 'anchor', token: literals[0]!, literal: true };
  return { kind: 'union', tokens, literals, prefixes, suffixes, contains, affixes };
}

function absorbGroup(info: GroupInfo, bucket: ProbeBucket): void {
  if (info.kind === 'anchor') {
    if (info.literal) remember(bucket.literals, bucket.seenLiterals, info.token);
    else remember(bucket.tokens, bucket.seenTokens, info.token);
    return;
  }
  if (info.kind !== 'union') return;
  for (const token of info.tokens) remember(bucket.tokens, bucket.seenTokens, token);
  for (const literal of info.literals) remember(bucket.literals, bucket.seenLiterals, literal);
  for (const prefix of info.prefixes) remember(bucket.prefixes, bucket.seenPrefixes, prefix);
  for (const suffix of info.suffixes) remember(bucket.suffixes, bucket.seenSuffixes, suffix);
  for (const needle of info.contains) remember(bucket.contains, bucket.seenContains, needle);
  for (const affix of info.affixes) {
    const key = `${affix.prefix}\0${affix.suffix}`;
    if (bucket.seenAffixes.has(key)) continue;
    bucket.seenAffixes.add(key);
    bucket.affixes.push(affix);
  }
}

/** Longest exact word that every match must include, when a form has one. */
function longestAnchor(
  anchors: Array<{ token: string; literal: boolean }>,
  literal: boolean,
): string {
  let best = '';
  for (const anchor of anchors) {
    if (anchor.literal !== literal) continue;
    if (anchor.token.length > best.length) best = anchor.token;
  }
  return best;
}

function absorbForm(source: string, bucket: ProbeBucket): 'constrained' | 'open' | 'invalid' {
  const parts = parseForm(source);
  if (!parts) return 'invalid';
  const groups = parts.map(analyzeGroup);
  const useful = groups.filter((group) => group.kind !== 'open');
  if (useful.length === 0) return 'open';

  const anchors = useful.filter(
    (group): group is Extract<GroupInfo, { kind: 'anchor' }> => group.kind === 'anchor',
  );
  const wordAnchor = longestAnchor(anchors, false);
  if (wordAnchor) {
    remember(bucket.tokens, bucket.seenTokens, wordAnchor);
    return 'constrained';
  }
  const literalAnchor = longestAnchor(anchors, true);
  if (literalAnchor) {
    remember(bucket.literals, bucket.seenLiterals, literalAnchor);
    return 'constrained';
  }
  for (const group of useful) absorbGroup(group, bucket);
  return 'constrained';
}

/** Probes for lemma ∪ forms. Empty `always: false` means the forms cannot match. */
export function highlightProbes(lemma: string, forms: readonly string[] = []): HighlightProbes {
  const bucket = emptyBucket();
  let always = false;
  for (const source of [lemma, ...forms]) {
    const result = absorbForm(source, bucket);
    if (result === 'open') always = true;
  }
  return {
    tokens: bucket.tokens,
    prefixes: bucket.prefixes,
    suffixes: bucket.suffixes,
    contains: bucket.contains,
    literals: bucket.literals,
    affixes: bucket.affixes,
    always,
  };
}

/**
 * True when `text` satisfies `probes`. Mirrors the content-script prefilter:
 * a regex match must never land on text this rejects.
 */
export function highlightProbeHits(probes: HighlightProbes, text: string): boolean {
  if (probes.always) return true;
  const haystack = text.toLowerCase();
  for (const literal of probes.literals) {
    if (haystack.includes(literal)) return true;
  }
  const tokens = haystack
    .split(TEXT_SPLIT_RE)
    .map((part) => part.replace(EDGE_RE, ''))
    .filter(Boolean);
  for (const token of tokens) {
    for (const probe of probes.tokens) {
      if (token === probe || token === probe.replace(EDGE_RE, '')) return true;
    }
    for (const prefix of probes.prefixes) {
      if (token.startsWith(prefix) && token.length > prefix.length) return true;
    }
    for (const suffix of probes.suffixes) {
      if (token.endsWith(suffix) && token.length > suffix.length) return true;
    }
    for (const needle of probes.contains) {
      if (token.includes(needle)) return true;
    }
    for (const affix of probes.affixes) {
      if (
        token.length > affix.prefix.length + affix.suffix.length &&
        token.startsWith(affix.prefix) &&
        token.endsWith(affix.suffix)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Compile authored forms; skip invalid strings. Longer sources first. */
export function compileFormSources(forms: readonly string[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const raw of forms) {
    const compiled = compileForm(raw);
    if (!compiled || seen.has(compiled)) continue;
    seen.add(compiled);
    sources.push(compiled);
  }
  sources.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return sources;
}
