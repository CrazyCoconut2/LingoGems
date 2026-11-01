import type { AiCredentialsStatus, AiKeyStatus, AiProviderId } from './types';

export const AI_PROVIDER_IDS: AiProviderId[] = ['openai', 'anthropic', 'google', 'groq'];

export const AI_DEFAULT_MODELS: Record<AiProviderId, string> = {
  openai: 'gpt-5',
  anthropic: 'claude-opus-4-5',
  google: 'gemini-3.6-pro',
  groq: 'openai/gpt-oss-120b',
};

/** Strongest first. BYOK completion walks this list until one model answers. */
export const AI_MODELS: Record<AiProviderId, readonly string[]> = {
  openai: ['gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
  anthropic: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-0',
    'claude-haiku-4-5',
    'claude-haiku-4-0',
  ],
  google: [
    'gemini-3.6-pro',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash-lite',
  ],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
};

export function modelsForProvider(provider: AiProviderId, extra?: string | null): string[] {
  const catalog = [...AI_MODELS[provider]];
  const saved = String(extra || '').trim();
  if (saved && !catalog.includes(saved)) {
    catalog.unshift(saved);
  }
  return catalog;
}

export function isAiProvider(value: string): value is AiProviderId {
  return AI_PROVIDER_IDS.includes(value as AiProviderId);
}

export function keyHintFromSecret(value: string): string {
  const secret = String(value || '').trim();
  if (!secret) {
    return '';
  }
  if (secret.length <= 4) {
    return `…${secret}`;
  }
  return `…${secret.slice(-4)}`;
}

function emptyAiCredentialsStatus(): AiCredentialsStatus {
  return { keys: [] };
}

export function normalizeAiCredentials(
  raw: Partial<AiCredentialsStatus> | null | undefined,
): AiCredentialsStatus {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.keys)) {
    return emptyAiCredentialsStatus();
  }

  const keys: AiKeyStatus[] = [];
  for (const entry of raw.keys) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id || '').trim();
    const provider = String(entry.provider || '').trim();
    if (!id || !isAiProvider(provider)) continue;
    const model = String(entry.model || '').trim();
    keys.push({
      id,
      provider,
      keyHint: String(entry.keyHint || ''),
      ...(model ? { model } : {}),
    });
  }
  return { keys };
}

export function hasActiveAiByok(status: AiCredentialsStatus | null | undefined): boolean {
  return Boolean(status?.keys?.length);
}
