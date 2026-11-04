export {
  isLearnableLanguage,
  languageDisplayName,
  LEARNABLE_LANGUAGES,
  type LearnableLanguage,
} from './languages/catalog';

export {
  addLanguage,
  readLanguages,
  saveLanguage,
  type StoredLanguage,
} from './languages/language-store';

export {
  addElement,
  deleteElement,
  DEFINITION_FREQUENCIES,
  definitionFrequencyLabel,
  displayTitle,
  readElements,
  assignEquivalent,
  embedTranslation,
  parsePassage,
  formTexts,
  elementModeLabel,
  normalizeDefinitionFrequency,
  saveElement,
  type ElementDefinition,
  type ElementForm,
  type DefinitionFrequency,
  type ParsedPassage,
  type PassageTranslation,
  type ElementEquivalent,
  type ElementExample,
  type ElementMetadata,
  type ElementMode,
  type ElementModeProgress,
  type StoredElement,
} from './elements/element-store';

export {
  HIGHLIGHT_STYLES,
  resolveHighlightStyle,
  sanitizeHighlightStyle,
  type HighlightStyle,
} from './elements/appearance';

export { isValidForm } from './elements/forms';

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
  elementMatchesMinimums,
  elementTranslationCount,
  parseElementMinimum,
  parseElementSort,
  type ElementSort,
} from './elements/browse';
