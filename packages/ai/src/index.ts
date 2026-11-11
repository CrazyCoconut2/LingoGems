export type { AiProviderId } from './types';

export { isAiProvider } from './credentials';

export { readStoredAiCredentials, writeStoredAiCredentials } from './storage';

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

export { generateEquivalent, translateTexts } from './translate';

export {
  generateDefinitionFromExample,
  generateDefinitions,
  generateElementFromSelection,
  generateForms,
} from './definitions';

export {
  MAX_EXAMPLE_INSTRUCTION,
  MAX_EXAMPLE_LENGTH,
  generateExamples,
  sentenceUsesForm,
} from './examples';

export { polishDefinition, type PolishDefinitionTask } from './polish-definition';

export { gradeDefinition } from './grade-definition';

export { gradeExample } from './grade-example';

export { polishExample } from './polish-example';

export { gradeEquivalent } from './grade-equivalent';

export {
  MAX_DEFINITION_INSTRUCTION,
  MAX_RELATED_PICKS,
  generateRelatedWords,
  verbalizeDefinition,
  type RelatedWord,
} from './definition-engineer';
