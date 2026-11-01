import { AI_ERROR, aiError } from '../errors';
import { fetchProviderJson } from '../http';
import { extractJsonObject } from '../parse';
import { AI_DEFAULT_MODELS } from '../credentials';
import type { CompleteChatInput, CompleteJsonInput, ProviderCredentials } from '../types';

const MAX_OUTPUT_TOKENS = 8192;

type GoogleGeneratePayload = {
  promptFeedback?: { blockReason?: unknown };
  candidates?: Array<{
    finishReason?: unknown;
    content?: { parts?: Array<{ thought?: unknown; text?: unknown }> };
  }>;
};

export function extractGoogleText(data: unknown): string {
  const payload = data && typeof data === 'object' ? (data as GoogleGeneratePayload) : {};
  const block = String(payload.promptFeedback?.blockReason || '').trim();
  if (block) {
    aiError(AI_ERROR.FAILED);
  }

  const candidate = payload.candidates?.[0];
  const finish = String(candidate?.finishReason || '').toUpperCase();
  if (
    finish === 'SAFETY' ||
    finish === 'BLOCKLIST' ||
    finish === 'PROHIBITED_CONTENT' ||
    finish === 'RECITATION'
  ) {
    aiError(AI_ERROR.FAILED);
  }

  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts
    .filter((part: { thought?: unknown }) => !part?.thought)
    .map((part: { text?: unknown }) => String(part?.text || ''))
    .join('');
}

async function generateGoogleContent(
  model: string,
  apiKey: string,
  input: CompleteJsonInput,
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return fetchProviderJson(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: input.user }],
          },
        ],
        generationConfig: {
          temperature: input.temperature ?? 0,
          maxOutputTokens: input.maxTokens ?? MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
        },
      }),
    },
    'google-complete',
  );
}

export async function completeJsonWithGoogle(
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }

  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.google;
  const data = await generateGoogleContent(model, apiKey, input);

  return extractJsonObject(extractGoogleText(data));
}

export async function completeChatWithGoogle(
  input: CompleteChatInput,
  credentials: ProviderCredentials,
): Promise<string> {
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    aiError(AI_ERROR.CREDENTIALS_INVALID);
  }
  const model = String(credentials?.model || '').trim() || AI_DEFAULT_MODELS.google;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = await fetchProviderJson(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: input.temperature ?? 0.7,
          maxOutputTokens: input.maxTokens ?? MAX_OUTPUT_TOKENS,
        },
      }),
    },
    'google-chat',
  );

  return extractGoogleText(data).trim();
}
