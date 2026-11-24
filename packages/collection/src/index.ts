export {
  isLearnableLanguage,
  languageDisplayName,
  LEARNABLE_LANGUAGES,
  type LearnableLanguage,
} from './languages/catalog';

export {
  absorbSavedElement,
  catalogFromElements,
  emptyElementCatalog,
  readMetadataCatalog,
  replaceMetadataCatalog,
  type ElementCatalog,
} from './elements/metadata-catalog';

export { sanitizeElementColor } from './elements/element-color';

export {
  addElement,
  commitElementCatalog,
  deleteElement,
  displayTitle,
  readAllElements,
  readElements,
  replaceCollection,
  assignEquivalent,
  sensesWithEquivalents,
  embedTranslation,
  equivalentTextFor,
  labeledSupportText,
  linkEquivalent,
  parsePassage,
  passageForEditing,
  pruneEquivalentLinks,
  readEditingDraft,
  formTexts,
  elementModeLabel,
  earnsGem,
  elementGemCounts,
  gameEarnedGem,
  type ElementGemCounts,
  saveElement,
  setElementWriteListener,
  DEFINITION_COVERAGE_MAX,
  DEFINITION_SCORE_MAX,
  TRANSLATION_GEM_MAX,
  gameScoreCeiling,
  type DefinitionDeleteLog,
  type DefinitionExampleLog,
  type DefinitionFormLog,
  type DefinitionGame,
  type DefinitionGameLog,
  type DefinitionLogBy,
  type DefinitionLogEntry,
  type DefinitionRevealLog,
  type DefinitionReworkLog,
  type DefinitionSnapshot,
  type ElementDefinition,
  type RemovedDefinition,
  type EquivalentLinks,
  type ElementForm,
  type ElementLogEntry,
  type ParsedPassage,
  type ElementEquivalent,
  type ElementMetadata,
  type ElementMode,
  type StoredElement,
} from './elements/element-store';

export { compileFormMatcher, formMatchesTerm, isValidForm, phraseTokens } from './elements/forms';

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
  definitionCoverage,
  definitionScoreAverage,
  definitionScoreStep,
  elementMatchesMetadata,
  elementMatchesColor,
  elementMatchesScore,
  elementScoreStep,
  formatMetadataFilter,
  metadataFilterSize,
  parseMetadataFilter,
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
