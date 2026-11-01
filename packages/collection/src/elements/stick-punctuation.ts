type StickPart = {
  text: string;
  lemma?: string | null;
  hit?: boolean;
};

/** Punctuation left on its own after a highlighted word, such as a final period. */
function danglingPunctuation(text: string): boolean {
  return /^\s*\p{P}+\s*$/u.test(text);
}

/** Keep a trailing mark with the previous word so a line break cannot isolate it. */
function gluePunctuation(text: string): string {
  const spaces = text.match(/^\s*/u)?.[0].length ?? 0;
  const punct = text.trim();
  return `${spaces ? '\u00A0'.repeat(spaces) : ''}${punct}`;
}

/**
 * A highlighted word is its own inline box. A period after it can wrap onto
 * the next line by itself. Fold that mark into the previous part.
 */
export function stickTrailingPunctuation<T extends StickPart>(parts: readonly T[]): T[] {
  const out: T[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && !part.lemma && !part.hit && danglingPunctuation(part.text)) {
      out[out.length - 1] = { ...prev, text: prev.text + gluePunctuation(part.text) };
      continue;
    }
    out.push(part);
  }
  return out;
}
