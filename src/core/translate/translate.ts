import {
  readStoredAiCredentials,
  readStoredTranslationCredentials,
  type StoredTranslationSecrets,
} from '../credentials/credentials';

/** Translate one phrase into English using the device's translation key, or its AI key. */
export async function translatePhrase(text: string, sourceLang: string): Promise<string> {
  const phrase = text.trim();
  if (!phrase) throw new Error('translate_failed');
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(phrase, sourceLang.trim())),
  });
  if (!response.ok) throw new Error('translate_failed');
  const payload = (await response.json()) as { translations?: Array<{ text?: unknown }> };
  const translated = String(payload.translations?.[0]?.text ?? '').trim();
  if (!translated) throw new Error('translate_failed');
  return translated;
}

function requestBody(text: string, sourceLang: string): Record<string, unknown> {
  const translation = readStoredTranslationCredentials().keys[0];
  if (translation) {
    return {
      texts: [text],
      targetLang: 'en',
      sourceLang,
      provider: translation.provider,
      secrets: secretsPayload(translation.secrets),
    };
  }
  const ai = readStoredAiCredentials().keys[0];
  if (!ai) throw new Error('translate_failed');
  return {
    texts: [text],
    targetLang: 'en',
    sourceLang,
    ai: { provider: ai.provider, apiKey: ai.apiKey, model: ai.model },
  };
}

function secretsPayload(secrets: StoredTranslationSecrets): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string' && value.trim()) payload[key] = value.trim();
  }
  return payload;
}
