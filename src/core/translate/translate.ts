import { translateDefinition, translateTexts } from 'ai';

/** Translate one phrase into the language chosen for this request. */
export async function translatePhrase(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const phrase = text.trim();
  const target = targetLang.trim();
  if (!phrase || !target) throw new Error('translate_failed');
  const [translated] = await translateTexts({
    texts: [phrase],
    targetLang: target,
    sourceLang: sourceLang.trim() || null,
  });
  const result = String(translated ?? '').trim();
  if (!result) throw new Error('translate_failed');
  return result;
}

/** The definition sentence in the target language, plus the headword equivalent for that sense. */
export async function translateDefinitionPhrase(
  lemma: string,
  definition: string,
  sourceLang: string,
  targetLang: string,
): Promise<{ translation: string; equivalent: string }> {
  const phrase = definition.trim();
  const headword = lemma.trim();
  const target = targetLang.trim();
  if (!phrase || !headword || !target) throw new Error('translate_failed');
  const result = await translateDefinition({
    lemma: headword,
    definition: phrase,
    sourceLang: sourceLang.trim(),
    targetLang: target,
  });
  const translation = result.translation.trim();
  if (!translation) throw new Error('translate_failed');
  return { translation, equivalent: result.equivalent.trim() };
}
