export {
  isLearnableLanguage,
  languageDisplayName,
  LEARNABLE_LANGUAGES,
  type LearnableLanguage,
} from './languages/catalog';

export { readMetadataCatalog, replaceMetadataCatalog } from './elements/metadata-catalog';

export {
  addElement,
  deleteElement,
  displayTitle,
  readAllElements,
  readElements,
  replaceCollection,
  assignEquivalent,
  embedTranslation,
  parsePassage,
  passageForEditing,
  readEditingDraft,
  formTexts,
  elementModeLabel,
  saveElement,
  setElementWriteListener,
  TRANSLATION_GEM_MAX,
  type DefinitionGame,
  type DefinitionGameLog,
  type DefinitionLogBy,
  type DefinitionLogEntry,
  type ElementDefinition,
  type ElementForm,
  type ElementLogEntry,
  type ParsedPassage,
  type ElementEquivalent,
  type ElementMetadata,
  type ElementMode,
  type StoredElement,
} from './elements/element-store';

export { formMatchesTerm, isValidForm } from './elements/forms';

export { surfaceSpans } from './elements/definition-eligibility';

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
  elementMatchesCountRanges,
  elementMatchesMetadata,
  elementMatchesComfort,
  elementMatchesMode,
  formatMetadataFilter,
  metadataFilterSize,
  parseMetadataFilter,
  setCountRangeBound,
  stepCountRange,
  type ElementCountRange,
  type ElementSort,
} from './elements/browse';

export { ELEMENTS_STORE, idbRequest, openDatabase } from './database';

export { requestPersistentStorage, storageIsPersistent } from './persistent-storage';

export {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
} from './elements/metadata-variability';
