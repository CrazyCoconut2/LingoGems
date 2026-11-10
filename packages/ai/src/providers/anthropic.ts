import { AI_ERROR, aiError } from '../errors';
import { fetchProviderJson } from '../http';
import { extractJsonObject } from '../parse';
import { AI_DEFAULT_MODELS } from '../credentials';
import type { CompleteJsonInput, ProviderCredentials } from '../types';

type AnthropicPayload = { content?: Array<{ type?: string; text?: string }> };

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export async function completeJsonWithAnthropic(
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }
  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.anthropic;
  const maxTokens = input.maxTokens ?? 2048;

  const data = (await fetchProviderJson(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: input.temperature ?? 0,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
    },
    'anthropic-complete',
  )) as AnthropicPayload;

  const content = Array.isArray(data?.content)
    ? data.content.find((part) => part?.type === 'text')?.text
    : '';
  return extractJsonObject(content);
}
