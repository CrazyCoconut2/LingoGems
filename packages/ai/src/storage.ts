import { isAiProvider } from './credentials';
import { AI_ERROR, aiError } from './errors';
import type { AiProviderId, StoredAiCredentials, StoredAiKey } from './types';

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

/** Appends a key. The same secret for the same provider is rejected. */
export function addStoredAiKey(provider: AiProviderId, apiKey: string, model = ''): StoredAiKey {
  const secret = apiKey.trim();
  if (!secret) aiError(AI_ERROR.CREDENTIALS_INVALID);
  const state = readStoredAiCredentials();
  if (state.keys.some((key) => key.provider === provider && key.apiKey === secret)) {
    aiError(AI_ERROR.CREDENTIALS_ALREADY_CONFIGURED);
  }
  const created: StoredAiKey = {
    id: newKeyId(),
    provider,
    apiKey: secret,
    model: model.trim(),
  };
  state.keys.push(created);
  writeStoredAiCredentials(state);
  return created;
}

export function removeStoredAiKey(id: string): void {
  const state = readStoredAiCredentials();
  state.keys = state.keys.filter((key) => key.id !== id);
  writeStoredAiCredentials(state);
}

/** Puts the listed ids first and keeps any id that was left out at the end. */
export function reorderStoredAiKeys(ids: readonly string[]): void {
  const state = readStoredAiCredentials();
  const byId = new Map(state.keys.map((key) => [key.id, key]));
  const next: StoredAiKey[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const key = byId.get(id);
    if (!key || seen.has(id)) continue;
    next.push(key);
    seen.add(id);
  }
  for (const key of state.keys) {
    if (!seen.has(key.id)) next.push(key);
  }
  state.keys = next;
  writeStoredAiCredentials(state);
}

function newKeyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Math.random().toString(36).slice(2, 12)}`;
}
