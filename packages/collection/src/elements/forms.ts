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
