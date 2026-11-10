export const AI_ERROR = {
  UNAVAILABLE: 'error.ai.unavailable',
  FAILED: 'error.ai.failed',
  QUOTA_EXCEEDED: 'error.ai.quotaExceeded',
  RESPONSE_INVALID: 'error.ai.responseInvalid',
  CREDENTIALS_INVALID: 'error.ai.credentialsInvalid',
  CREDENTIALS_PROVIDER_INVALID: 'error.ai.credentialsProviderInvalid',
  CREDENTIALS_REQUIRED: 'error.ai.credentialsRequired',
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

export function aiError(code: string, status = 400, providerStatus?: number): never {
  throw new AiError(code, status, providerStatus);
}
