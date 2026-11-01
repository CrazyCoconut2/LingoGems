export const AI_ERROR = {
  UNAVAILABLE: 'error.ai.unavailable',
  FAILED: 'error.ai.failed',
  QUOTA_EXCEEDED: 'error.ai.quotaExceeded',
  RESPONSE_INVALID: 'error.ai.responseInvalid',
  CREDENTIALS_INVALID: 'error.ai.credentialsInvalid',
  CREDENTIALS_PROVIDER_INVALID: 'error.ai.credentialsProviderInvalid',
  CREDENTIALS_NOT_CONFIGURED: 'error.ai.credentialsNotConfigured',
  CREDENTIALS_REQUIRED: 'error.ai.credentialsRequired',
  CREDENTIALS_ALREADY_CONFIGURED: 'error.ai.credentialsAlreadyConfigured',
  PROVIDER_AUTH_FAILED: 'error.ai.providerAuthFailed',
} as const;

export class AiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly providerStatus?: number;
  /** System and user text from the failed call, ready to paste into another AI. */
  prompt = '';

  constructor(code: string, status = 400, providerStatus?: number) {
    super(code);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
  }
}

/** One message a person can paste into a chat AI: instructions, then the user payload. */
export function copyableAiPrompt(input: { system: string; user: string }): string {
  const system = input.system.trim();
  const user = input.user.trim();
  if (system && user) return `${system}\n\n${user}`;
  return system || user;
}

export function attachAiPrompt<T>(err: T, input: { system: string; user: string }): T {
  if (err instanceof AiError) {
    err.prompt = copyableAiPrompt(input);
  }
  return err;
}

export function aiErrorPrompt(err: unknown): string {
  return err instanceof AiError ? err.prompt : '';
}

export function aiError(code: string, status = 400, providerStatus?: number): never {
  throw new AiError(code, status, providerStatus);
}

export function translateAiError(
  err: unknown,
  language: { translate(key: string): string },
  fallbackKey: string,
): string {
  if (err instanceof AiError) {
    const text = language.translate(err.code);
    if (text !== err.code) {
      return text;
    }
  }
  return language.translate(fallbackKey);
}
