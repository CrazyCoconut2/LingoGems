export type {
  AiCredentialsStatus,
  AiKeyStatus,
  AiProviderId,
  ChatMessage,
  CompleteChatInput,
  CompleteJsonInput,
  StoredAiCredentials,
  StoredAiKey,
} from './types';

export {
  AI_DEFAULT_MODELS,
  AI_MODELS,
  AI_PROVIDER_IDS,
  hasActiveAiByok,
  isAiProvider,
  keyHintFromSecret,
  modelsForProvider,
  normalizeAiCredentials,
} from './credentials';

export {
  parseStoredAiCredentials,
  readStoredAiCredentials,
  writeStoredAiCredentials,
} from './storage';

export { completeChat, completeJson, runWithKeyFallback } from './complete';

export {
  AI_ERROR,
  AiError,
  aiError,
  aiErrorPrompt,
  attachAiPrompt,
  translateAiError,
} from './errors';

export {
  TRANSLATE_SYSTEM_PROMPT,
  buildTranslateUserMessage,
  parseGeneratedTranslations,
  translateTexts,
  type GenerateTranslatePromptInput,
} from './translate';
