export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'groq';

export type TranslationProviderId = 'deepl' | 'google' | 'azure' | 'amazon';

export type StoredAiKey = {
  id: string;
  provider: AiProviderId;
  apiKey: string;
  model: string;
};

export type StoredAiCredentials = {
  keys: StoredAiKey[];
};

export type StoredTranslationSecrets = {
  apiKey?: string;
  subscriptionKey?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type StoredTranslationKey = {
  id: string;
  provider: TranslationProviderId;
  secrets: StoredTranslationSecrets;
};

export type StoredTranslationCredentials = {
  keys: StoredTranslationKey[];
};

const ONBOARDED_KEY = 'lingogem.is-onboarded';
const AI_CREDENTIALS_KEY = 'lingogem.ai-credentials.v1';
const TRANSLATION_CREDENTIALS_KEY = 'lingogem.translation-credentials.v1';

const AI_PROVIDER_IDS: AiProviderId[] = ['openai', 'anthropic', 'google', 'groq'];
const TRANSLATION_PROVIDER_IDS: TranslationProviderId[] = ['deepl', 'google', 'azure', 'amazon'];

export function isAiProvider(value: string): value is AiProviderId {
  return AI_PROVIDER_IDS.includes(value as AiProviderId);
}

export function isTranslationProvider(value: string): value is TranslationProviderId {
  return TRANSLATION_PROVIDER_IDS.includes(value as TranslationProviderId);
}

export function isOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ONBOARDED_KEY) === 'true';
}

export function markOnboarded(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ONBOARDED_KEY, 'true');
}

export function readStoredAiCredentials(): StoredAiCredentials {
  return parseStoredAiCredentials(readJson(AI_CREDENTIALS_KEY));
}

export function writeStoredAiCredentials(state: StoredAiCredentials): void {
  writeJson(AI_CREDENTIALS_KEY, state);
}

export function readStoredTranslationCredentials(): StoredTranslationCredentials {
  return parseStoredTranslationCredentials(readJson(TRANSLATION_CREDENTIALS_KEY));
}

export function writeStoredTranslationCredentials(state: StoredTranslationCredentials): void {
  writeJson(TRANSLATION_CREDENTIALS_KEY, state);
}

export function secretsForProvider(
  provider: TranslationProviderId,
  raw: StoredTranslationSecrets,
): StoredTranslationSecrets | null {
  if (provider === 'deepl' || provider === 'google') {
    const apiKey = String(raw.apiKey || '').trim();
    return apiKey ? { apiKey } : null;
  }
  if (provider === 'azure') {
    const subscriptionKey = String(raw.subscriptionKey || '').trim();
    const region = String(raw.region || '').trim();
    return subscriptionKey && region ? { subscriptionKey, region } : null;
  }
  const accessKeyId = String(raw.accessKeyId || '').trim();
  const secretAccessKey = String(raw.secretAccessKey || '').trim();
  const region = String(raw.region || '').trim();
  return accessKeyId && secretAccessKey && region ? { accessKeyId, secretAccessKey, region } : null;
}

function readJson(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

function parseStoredAiCredentials(raw: unknown): StoredAiCredentials {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { keys?: unknown }).keys)) {
    return { keys: [] };
  }
  const keys: StoredAiKey[] = [];
  for (const entry of (raw as { keys: unknown[] }).keys) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String((entry as { id?: unknown }).id ?? '').trim();
    const provider = String((entry as { provider?: unknown }).provider ?? '').trim();
    const apiKey = String((entry as { apiKey?: unknown }).apiKey ?? '').trim();
    if (!id || !isAiProvider(provider) || !apiKey) continue;
    keys.push({
      id,
      provider,
      apiKey,
      model: String((entry as { model?: unknown }).model ?? '').trim(),
    });
  }
  return { keys };
}

function parseStoredTranslationCredentials(raw: unknown): StoredTranslationCredentials {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { keys?: unknown }).keys)) {
    return { keys: [] };
  }
  const keys: StoredTranslationKey[] = [];
  for (const entry of (raw as { keys: unknown[] }).keys) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String((entry as { id?: unknown }).id ?? '').trim();
    const provider = String((entry as { provider?: unknown }).provider ?? '').trim();
    if (!id || !isTranslationProvider(provider)) continue;
    const secrets = secretsForProvider(
      provider,
      ((entry as { secrets?: unknown }).secrets ?? {}) as StoredTranslationSecrets,
    );
    if (!secrets) continue;
    keys.push({ id, provider, secrets });
  }
  return { keys };
}
