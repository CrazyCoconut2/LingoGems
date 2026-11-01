import { translateTexts } from 'ai';

/** Translate one phrase into English with the device's AI key. */
export async function translatePhrase(text: string, sourceLang: string): Promise<string> {
  const phrase = text.trim();
  if (!phrase) throw new Error('translate_failed');
  const [translated] = await translateTexts({
    texts: [phrase],
    targetLang: 'en',
    sourceLang: sourceLang.trim() || null,
  });
  const result = String(translated ?? '').trim();
  if (!result) throw new Error('translate_failed');
  return result;
}
