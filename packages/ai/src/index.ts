export type { AiProviderId, StoredAiKey } from './types';

export { isAiProvider, keyHintFromSecret } from './credentials';

export { AI_ERROR, AiError } from './errors';

export { testAiKey } from './complete';

export {
  addStoredAiKey,
  readStoredAiCredentials,
  removeStoredAiKey,
  reorderStoredAiKeys,
  writeStoredAiCredentials,
} from './storage';

export {
  DEFAULT_DEFINITION_METADATA_FIELDS,
  DEFAULT_EXAMPLE_METADATA_FIELDS,
  DEFAULT_FORM_METADATA_FIELDS,
  MAX_METADATA_FIELD_KEY,
  MAX_METADATA_FIELD_PROMPT,
  MAX_METADATA_FIELDS,
  readDefinitionExtraFields,
  readDefinitionMetadataFields,
  readExampleExtraFields,
  readExampleMetadataFields,
  readFormExtraFields,
  readFormMetadataFields,
  resetDefinitionMetadataFields,
  resetExampleMetadataFields,
  resetFormMetadataFields,
  writeDefinitionExtraFields,
  writeDefinitionMetadataFields,
  writeExampleExtraFields,
  writeExampleMetadataFields,
  writeFormExtraFields,
  writeFormMetadataFields,
  type AiMetadataField,
} from './metadata-fields';

export { recommendMetadataFields } from './recommend-metadata';

export { suggestMetadata } from './suggest-metadata';

export {
  MAX_DISCOVER_INSTRUCTION,
  discoverElements,
  type DiscoveredElement,
} from './discover-elements';

export { generateEquivalent, translateDefinition, translateTexts } from './translate';
export type { DefinitionTranslation } from './translate';

export {
  generateDefinitionFromExample,
  generateElementFromSelection,
  generateForms,
  type GeneratedDefinition,
} from './definitions';

export {
  MAX_EXAMPLE_INSTRUCTION,
  MAX_EXAMPLE_LENGTH,
  generateExamples,
  sentenceUsesForm,
} from './examples';

export {
  MAX_DEFINITION_INSTRUCTION,
  MAX_RELATED_PICKS,
  generateRelatedWords,
  verbalizeDefinition,
  type RelatedWord,
} from './definition-engineer';

export {
  correctRecallAnswer,
  evaluateRecallAnswer,
  type RecallCommittedMistake,
  type RecallCorrection,
  type RecallEvaluation,
  type RecallMistake,
  type RecallPriorMistake,
  type RecallResolvedMistake,
  type RecallSense,
} from './recall';

export { suggestReformulations, type ReformulationSuggestion } from './reformulate';
