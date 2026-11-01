import { AI_ERROR, AiError, aiError } from './errors';
import { isAiProvider, modelsForProvider } from './credentials';
import { completeChatWithAnthropic, completeJsonWithAnthropic } from './providers/anthropic';
import { completeChatWithGoogle, completeJsonWithGoogle } from './providers/google';
import { completeChatWithGroq, completeJsonWithGroq } from './providers/groq';
import { completeChatWithOpenAI, completeJsonWithOpenAI } from './providers/openai';
import type {
  AiProviderId,
  CompleteChatInput,
  CompleteJsonInput,
  ProviderCredentials,
} from './types';

function isRetryableAiModelError(err: unknown): boolean {
  if (!(err instanceof AiError)) return false;
  return (
    err.code === AI_ERROR.FAILED ||
    err.code === AI_ERROR.UNAVAILABLE ||
    err.code === AI_ERROR.RESPONSE_INVALID ||
    err.code === AI_ERROR.QUOTA_EXCEEDED
  );
}

async function completeWithProvider(
  provider: AiProviderId,
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  switch (provider) {
    case 'openai':
      return completeJsonWithOpenAI(input, credentials);
    case 'anthropic':
      return completeJsonWithAnthropic(input, credentials);
    case 'google':
      return completeJsonWithGoogle(input, credentials);
    case 'groq':
      return completeJsonWithGroq(input, credentials);
    default:
      aiError(AI_ERROR.CREDENTIALS_PROVIDER_INVALID);
  }
}

async function chatWithProvider(
  provider: AiProviderId,
  input: CompleteChatInput,
  credentials: ProviderCredentials,
): Promise<string> {
  switch (provider) {
    case 'openai':
      return completeChatWithOpenAI(input, credentials);
    case 'anthropic':
      return completeChatWithAnthropic(input, credentials);
    case 'google':
      return completeChatWithGoogle(input, credentials);
    case 'groq':
      return completeChatWithGroq(input, credentials);
    default:
      aiError(AI_ERROR.CREDENTIALS_PROVIDER_INVALID);
  }
}

/** Walks the provider's model list until one model answers. */
async function withModelFallback<T>(
  provider: string,
  credentials: ProviderCredentials,
  run: (provider: AiProviderId, credentials: ProviderCredentials) => Promise<T>,
): Promise<T> {
  if (!isAiProvider(provider)) {
    aiError(AI_ERROR.CREDENTIALS_PROVIDER_INVALID);
  }

  const models = modelsForProvider(provider, credentials.model);
  let lastError: unknown;
  for (const model of models) {
    try {
      return await run(provider, { ...credentials, model });
    } catch (err) {
      lastError = err;
      if (!isRetryableAiModelError(err)) {
        throw err;
      }
    }
  }
  if (lastError instanceof AiError) {
    throw lastError;
  }
  aiError(AI_ERROR.FAILED);
}

export async function completeJson(
  provider: string,
  input: CompleteJsonInput,
  credentials: ProviderCredentials,
): Promise<Record<string, unknown>> {
  return withModelFallback(provider, credentials, (id, creds) =>
    completeWithProvider(id, input, creds),
  );
}

/** Multi-turn plain-text completion. Returns the assistant reply. */
export async function completeChat(
  provider: string,
  input: CompleteChatInput,
  credentials: ProviderCredentials,
): Promise<string> {
  return withModelFallback(provider, credentials, async (id, creds) => {
    const text = await chatWithProvider(id, input, creds);
    if (!text) {
      aiError(AI_ERROR.RESPONSE_INVALID);
    }
    return text;
  });
}

const ATTEMPTS_PER_KEY = 2;

export type KeyFallbackTarget = {
  id: string;
  provider: AiProviderId;
  apiKey: string;
  model?: string;
};

/** Each key gets two model walks. The first answer wins. The list order is left unchanged. */
export async function runWithKeyFallback<T>(
  keys: readonly KeyFallbackTarget[],
  run: (provider: AiProviderId, credentials: ProviderCredentials) => Promise<T>,
): Promise<T> {
  if (keys.length === 0) {
    aiError(AI_ERROR.CREDENTIALS_REQUIRED);
  }
  let lastError: unknown;
  for (const key of keys) {
    const credentials: ProviderCredentials = {
      apiKey: key.apiKey,
      ...(key.model ? { model: key.model } : {}),
    };
    for (let attempt = 0; attempt < ATTEMPTS_PER_KEY; attempt++) {
      try {
        return await run(key.provider, credentials);
      } catch (err) {
        lastError = err;
      }
    }
  }
  if (lastError instanceof AiError) throw lastError;
  if (lastError instanceof Error) throw lastError;
  aiError(AI_ERROR.FAILED);
}
