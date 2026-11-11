import { isAiProvider } from './credentials';
import type { StoredAiCredentials, StoredAiKey } from './types';

const AI_CREDENTIALS_KEY = 'lingogem.ai-credentials.v1';

function emptyStoredAiCredentials(): StoredAiCredentials {
  return { keys: [] };
}

function readKey(raw: unknown): StoredAiKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String((raw as { id?: unknown }).id ?? '').trim();
  const provider = String((raw as { provider?: unknown }).provider ?? '').trim();
  const apiKey = String((raw as { apiKey?: unknown }).apiKey ?? '').trim();
  if (!id || !isAiProvider(provider) || !apiKey) return null;
  return {
    id,
    provider,
    apiKey,
    model: String((raw as { model?: unknown }).model ?? '').trim(),
  };
}

function parseStoredAiCredentials(raw: unknown): StoredAiCredentials {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { keys?: unknown }).keys)) {
    return emptyStoredAiCredentials();
  }
  return {
    keys: (raw as { keys: unknown[] }).keys
      .map(readKey)
      .filter((entry): entry is StoredAiKey => entry !== null),
  };
}

export function readStoredAiCredentials(): StoredAiCredentials {
  if (typeof localStorage === 'undefined') return emptyStoredAiCredentials();
  try {
    const raw = localStorage.getItem(AI_CREDENTIALS_KEY);
    if (!raw) return emptyStoredAiCredentials();
    return parseStoredAiCredentials(JSON.parse(raw) as unknown);
  } catch {
    return emptyStoredAiCredentials();
  }
}

export function writeStoredAiCredentials(state: StoredAiCredentials): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AI_CREDENTIALS_KEY, JSON.stringify(state));
}
