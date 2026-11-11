export {
  isLearnableLanguage,
  languageDisplayName,
  LEARNABLE_LANGUAGES,
  type LearnableLanguage,
} from './languages/catalog';

export {
  mergeMetadataCatalog,
  readMetadataCatalog,
  replaceMetadataCatalog,
} from './elements/metadata-catalog';

export {
  addElement,
  deleteElement,
  displayTitle,
  readAllElements,
  readElements,
  assignEquivalent,
  embedTranslation,
  parsePassage,
  passageForEditing,
  readEditingDraft,
  formTexts,
  elementModeLabel,
  elementReadyForTranslation,
  saveElement,
  TRANSLATION_GEM_MAX,
  type DefinitionLogBy,
  type DefinitionLogEntry,
  type ElementDefinition,
  type ElementForm,
  type ParsedPassage,
  type PassageTranslation,
  type ElementEquivalent,
  type ElementExample,
  type ElementMetadata,
  type ElementMode,
  type StoredElement,
} from './elements/element-store';

export { formMatchesTerm, isValidForm } from './elements/forms';

export {
  definitionEligibleForGames,
  definitionSelfMentionWarningFor,
  elementHasInvalidDefinition,
  surfaceSpans,
  type SurfaceSpan,
} from './elements/definition-eligibility';

export {
  highlightDefinitionPassage,
  type DefinitionHighlightMatch,
  type DefinitionHighlightPart,
} from './elements/highlight';

export {
  ELEMENT_SEARCH_MAX_LENGTH,
  elementHighlightParts,
  elementMatchesPrefix,
  elementPrefixSearch,
  type ElementSearch,
  type ElementSearchPart,
} from './elements/search';

export {
  DEFAULT_ELEMENT_SORT,
  compareElements,
  elementDefinitionCount,
  elementMatchesCountRanges,
  elementMatchesMetadata,
  elementMatchesComfort,
  elementMatchesMode,
  elementTranslationCount,
  formatMetadataFilter,
  metadataFilterSize,
  parseMetadataFilter,
  setCountRangeBound,
  stepCountRange,
  type ElementCountRange,
  type ElementSort,
} from './elements/browse';

export { requestPersistentStorage, storageIsPersistent } from './persistent-storage';

export {
  collectMetadataIndexes,
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
} from './elements/metadata-variability';
