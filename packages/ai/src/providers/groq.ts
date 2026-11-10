import { AI_ERROR, aiError } from '../errors';
import { fetchProviderJson } from '../http';
import { extractJsonObject } from '../parse';
import { AI_DEFAULT_MODELS } from '../credentials';
import type { CompleteJsonInput, ProviderCredentials } from '../types';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function completeJsonWithGroq(
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }
  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.groq;
  const maxTokens = input.maxTokens ?? 2048;

  const data = (await fetchProviderJson(
    GROQ_CHAT_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    },
    'groq-complete',
  )) as { choices?: Array<{ message?: { content?: unknown } }> };

  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}
