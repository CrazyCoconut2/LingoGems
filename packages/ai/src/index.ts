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

export {
  readGenerateDefinitionTranslations,
  readGenerateExampleTranslations,
  translationLanguage,
  writeGenerateDefinitionTranslations,
  writeGenerateExampleTranslations,
} from './translation-settings';

export {
  DEFAULT_DEFINITION_METADATA_FIELDS,
  DEFAULT_EXAMPLE_METADATA_FIELDS,
  MAX_METADATA_FIELD_KEY,
  MAX_METADATA_FIELD_PROMPT,
  MAX_METADATA_FIELDS,
  metadataFieldsMatch,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  readExampleExtraFields,
  readExampleMetadataFields,
  resetDefinitionMetadataFields,
  writeDefinitionExtraFields,
  writeExampleExtraFields,
  resetExampleMetadataFields,
  writeDefinitionMetadataFields,
  writeExampleMetadataFields,
  type AiMetadataField,
} from './metadata-fields';

export {
  buildRecommendMetadataUserMessage,
  parseRecommendedMetadataFields,
  recommendMetadataFields,
} from './recommend-metadata';

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
  EQUIVALENT_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildEquivalentUserMessage,
  buildTranslateUserMessage,
  generateEquivalent,
  parseGeneratedEquivalent,
  parseGeneratedTranslations,
  translateTexts,
  type GenerateEquivalentInput,
  type GenerateTranslatePromptInput,
} from './translate';

export {
  FORMS_SYSTEM_PROMPT,
  definitionFromExampleSystemPrompt,
  definitionsSystemPrompt,
  elementFromSelectionSystemPrompt,
  buildDefinitionFromExampleUserMessage,
  buildDefinitionsUserMessage,
  buildFormsUserMessage,
  generateDefinitionFromExample,
  generateDefinitions,
  generateElementFromSelection,
  generateForms,
  parseGeneratedDefinitions,
  parseGeneratedForms,
  type GenerateDefinitionFromExampleInput,
  type GenerateDefinitionsInput,
  type GenerateElementFromSelectionInput,
  type GenerateFormsInput,
  type GeneratedDefinition,
  type GeneratedElement,
} from './definitions';

export {
  MAX_EXAMPLE_INSTRUCTION,
  MAX_EXAMPLE_LENGTH,
  MAX_EXAMPLE_WORDS,
  buildExamplesUserMessage,
  examplesSystemPrompt,
  generateExamples,
  parseGeneratedExamples,
  sentenceUsesForm,
  type GenerateExamplesInput,
  type GeneratedExample,
} from './examples';

export {
  DEFINITION_PHRASE_SYSTEM_PROMPT,
  DEFINITION_RELATIONS,
  MAX_DEFINITION_INSTRUCTION,
  MAX_DEFINITION_WORDING,
  MAX_RELATED_PICKS,
  RELATED_WORDS_SYSTEM_PROMPT,
  buildDefinitionPhraseUserMessage,
  buildRelatedWordsUserMessage,
  generateRelatedWords,
  parseGeneratedDefinitionPhrase,
  parseGeneratedRelatedWords,
  verbalizeDefinition,
  type DefinitionRelation,
  type GenerateDefinitionPhraseInput,
  type GenerateRelatedWordsInput,
  type GeneratedDefinitionPhrase,
  type RelatedWord,
} from './definition-engineer';
