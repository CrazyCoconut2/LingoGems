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

export {
  addElement,
  commitElementCatalog,
  deleteElement,
  displayTitle,
  mergeElements,
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
  saveElement,
  setElementWriteListener,
  DEFINITION_COVERAGE_MAX,
  DEFINITION_SCORE_MAX,
  type DefinitionDeleteLog,
  type DefinitionExampleLog,
  type DefinitionFormLog,
  type DefinitionGame,
  type DefinitionGameLog,
  type DefinitionLogBy,
  type DefinitionLogEntry,
  type DefinitionRevealLog,
  type DefinitionReworkLog,
  type DefinitionSeenLog,
  type DefinitionSnapshot,
  type ElementDefinition,
  type RemovedDefinition,
  type EquivalentLinks,
  type ElementForm,
  type ElementLogEntry,
  type ParsedPassage,
  type ElementEquivalent,
  type ElementMetadata,
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
  elementMatchesScore,
  elementScoreStep,
  formatMetadataFilter,
  metadataFilterSize,
  parseMetadataFilter,
  type ElementSort,
} from './elements/browse';

export { ELEMENTS_STORE, TRANSLATIONS_STORE, idbRequest, openDatabase } from './database';

export {
  loadPhraseTranslations,
  normalizeStoredPhraseTranslations,
  notePhraseUnveil,
  setPhraseTranslationListener,
  readAllPhraseTranslations,
  readPhraseTranslation,
  recordPhraseTranslation,
  replacePhraseTranslation,
  replacePhraseTranslations,
  type PhraseTranslation,
  type StoredPhraseTranslation,
} from './translations/phrase-store';

export {
  applyGrammarOutcome,
  grammarCorrectionMarks,
  grammarMistakeOpen,
  grammarRules,
  grammarSentenceMarks,
  grammarStats,
  readGrammarInputs,
  readGrammarMistakes,
  readOpenGrammarMistakes,
  type GrammarCommit,
  type GrammarInput,
  type GrammarInputRule,
  type GrammarInstance,
  type GrammarMark,
  type GrammarMistake,
  type GrammarMovement,
  type GrammarResolution,
  type GrammarRuleStats,
  type GrammarStats,
  type GrammarTotals,
} from './grammar/grammar-store';

export {
  reformulationMarks,
  type ReformulationChange,
  type ReformulationMark,
} from './formulation/reformulation-store';

export { requestPersistentStorage, storageIsPersistent } from './persistent-storage';

export {
  emptyMetadataIndexes,
  mergeMetadataIndexes,
  mergeMetadataVariability,
  normalizeMetadataVariability,
  type ElementMetadataIndexes,
  type ElementMetadataVariability,
} from './elements/metadata-variability';
