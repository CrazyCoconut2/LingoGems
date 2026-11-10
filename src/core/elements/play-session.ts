import { surfaceSpans, type DefinitionLogBy } from 'collection';
import type { GradedDefinition } from 'ai';

export const EQUIVALENT_MAX = 200;
export const DEFINITION_MAX = 500;

export type AnswerLanguage = 'original' | 'english';

/** Gems attributed to one answer in the current round. */
export type EquivalentReward = {
  gems: number;
  by: DefinitionLogBy;
  explanation: string;
};

export type PlayRound = {
  equivalentDrafts: string[];
  equivalentSubmitted: boolean[];
  equivalentRewards: Array<EquivalentReward | null>;
  /** Index of this attempt inside the definition log. Null until it is saved. */
  equivalentLogIndexes: Array<number | null>;
  definitionDrafts: string[];
  /** Support-language wording written beside the working-language answer. */
  definitionSupportDrafts: string[];
  definitionSubmitted: boolean[];
  definitionRewards: Array<EquivalentReward | null>;
  /** Index of this definition attempt inside the definition log. Null until it is saved. */
  definitionLogIndexes: Array<number | null>;
  definitionLanguages: AnswerLanguage[];
  grades: Array<GradedDefinition | null>;
  definitionTranslations: string[];
  exampleDrafts: string[];
  /** Support-language wording written beside the working-language example. */
  exampleSupportDrafts: string[];
  exampleSubmitted: boolean[];
  exampleRewards: Array<EquivalentReward | null>;
  /** Index of this example attempt inside the definition log. Null until it is saved. */
  exampleLogIndexes: Array<number | null>;
  /** The learner stopped this round. The card is shown again. */
  givenUp: boolean;
};

export function emptyPlayRound(): PlayRound {
  return {
    equivalentDrafts: [],
    equivalentSubmitted: [],
    equivalentRewards: [],
    equivalentLogIndexes: [],
    definitionDrafts: [],
    definitionSupportDrafts: [],
    definitionSubmitted: [],
    definitionRewards: [],
    definitionLogIndexes: [],
    definitionLanguages: [],
    grades: [],
    definitionTranslations: [],
    exampleDrafts: [],
    exampleSupportDrafts: [],
    exampleSubmitted: [],
    exampleRewards: [],
    exampleLogIndexes: [],
    givenUp: false,
  };
}

/** True when the sentence contains the title or one of the given forms. */
export function exampleContainsForm(
  sentence: string,
  title: string,
  forms: readonly string[],
): boolean {
  return surfaceSpans(sentence, title, forms).length > 0;
}
