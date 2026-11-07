export {
  isLearnableLanguage,
  languageDisplayName,
  LEARNABLE_LANGUAGES,
  type LearnableLanguage,
} from './languages/catalog';

export {
  addLanguage,
  mergeLanguageMetadata,
  readLanguage,
  readLanguages,
  replaceLanguageMetadata,
  saveLanguage,
  type StoredLanguage,
} from './languages/language-store';

export {
  addElement,
  deleteElement,
  displayTitle,
  readElements,
  assignEquivalent,
  embedTranslation,
  parsePassage,
  formTexts,
  elementModeLabel,
  saveElement,
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

export {
  HIGHLIGHT_STYLES,
  resolveHighlightStyle,
  sanitizeHighlightStyle,
  type HighlightStyle,
} from './elements/appearance';

export { formMatchesTerm, isValidForm } from './elements/forms';

export {
  definitionEligibleForGames,
  definitionSelfMentionWarningFor,
  definitionSelfMentions,
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
  ELEMENT_SORTS,
  compareElements,
  elementDefinitionCount,
  elementMatchesCountRanges,
  elementMatchesMetadata,
  elementMatchesComfort,
  elementMatchesMode,
  elementTranslationCount,
  formatElementCountRange,
  formatMetadataFilter,
  metadataFilterSize,
  parseElementCountRange,
  parseComfort,
  parseElementMode,
  parseElementSort,
  parseMetadataFilter,
  setCountRangeBound,
  stepCountRange,
  type ElementCountRange,
  type ElementSort,
} from './elements/browse';

export {
  collectMetadataIndexes,
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
} from './elements/metadata-variability';
