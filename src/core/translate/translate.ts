import { translateTexts } from 'ai';

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
