export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'groq';

export type AiKeyStatus = {
  id: string;
  provider: AiProviderId;
  keyHint: string;
  model?: string;
};

export type AiCredentialsStatus = {
  keys: AiKeyStatus[];
};

export type CompleteJsonInput = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type CompleteChatInput = {
  system: string;
  messages: ChatMessage[];
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
