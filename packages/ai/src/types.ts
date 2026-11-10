export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'groq';

export type CompleteJsonInput = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

export type ProviderCredentials = {
  apiKey: string;
  model?: string;
};

export type StoredAiKey = {
  id: string;
  provider: AiProviderId;
  apiKey: string;
  model: string;
};

export type StoredAiCredentials = {
  keys: StoredAiKey[];
};
