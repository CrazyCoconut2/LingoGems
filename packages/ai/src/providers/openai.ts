import { AI_ERROR, aiError } from '../errors';
import { fetchProviderJson } from '../http';
import { extractJsonObject } from '../parse';
import { AI_DEFAULT_MODELS } from '../credentials';
import type { CompleteChatInput, CompleteJsonInput, ProviderCredentials } from '../types';

type ChatCompletionPayload = { choices?: Array<{ message?: { content?: unknown } }> };

export async function completeJsonWithOpenAI(
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }
  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.openai;
  const maxTokens = input.maxTokens ?? 2048;

  const data = (await fetchProviderJson(
    'https://api.openai.com/v1/chat/completions',
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
    'openai-complete',
  )) as ChatCompletionPayload;

  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

/** OpenAI-compatible chat completion (OpenAI and Groq). Returns the reply text. */
export async function completeChatWithOpenAiCompatible(
  url: string,
  logLabel: string,
  input: CompleteChatInput,
  apiKey: string,
  model: string,
): Promise<string> {
  const data = (await fetchProviderJson(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 4096,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages.map((message) => ({ role: message.role, content: message.content })),
        ],
      }),
    },
    logLabel,
  )) as ChatCompletionPayload;

  return String(data?.choices?.[0]?.message?.content ?? '').trim();
}

export async function completeChatWithOpenAI(
  input: CompleteChatInput,
  credentials: ProviderCredentials,
): Promise<string> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }
  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.openai;
  return completeChatWithOpenAiCompatible(
    'https://api.openai.com/v1/chat/completions',
    'openai-chat',
    input,
    apiKey,
    model,
  );
}
