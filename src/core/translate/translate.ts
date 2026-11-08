import { readTranslationLanguage, translateTexts } from 'ai';

/** Translate one phrase into the language chosen in Settings. */
export async function translatePhrase(text: string, sourceLang: string): Promise<string> {
  const phrase = text.trim();
  if (!phrase) throw new Error('translate_failed');
  const [translated] = await translateTexts({
    texts: [phrase],
    targetLang: readTranslationLanguage(sourceLang),
    sourceLang: sourceLang.trim() || null,
  });
  const result = String(translated ?? '').trim();
  if (!result) throw new Error('translate_failed');
  return result;
}
