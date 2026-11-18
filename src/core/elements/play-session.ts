import { type DefinitionLogBy } from 'collection';

export const EQUIVALENT_MAX = 200;
export const DEFINITION_MAX = 500;

/** Score attributed to one answer in the current round. */
export type EquivalentReward = {
  score: number;
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
  exampleDrafts: string[];
  /** Support-language wording written beside the working-language example. */
  exampleSupportDrafts: string[];
  exampleSubmitted: boolean[];
  exampleRewards: Array<EquivalentReward | null>;
  /** Index of this example attempt inside the definition log. Null until it is saved. */
  exampleLogIndexes: Array<number | null>;
  /**
   * Definitions on the card when this round started.
   * Null until play seats them. A definition added later is false.
   */
  included: boolean[] | null;
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
    exampleDrafts: [],
    exampleSupportDrafts: [],
    exampleSubmitted: [],
    exampleRewards: [],
    exampleLogIndexes: [],
    included: null,
    givenUp: false,
  };
}

function insertAt<T>(
  list: readonly T[] | undefined,
  index: number,
  items: readonly T[],
  fill: T,
): T[] {
  const next = [...(list ?? [])];
  while (next.length < index) next.push(fill);
  next.splice(index, 0, ...items);
  return next;
}

function removeAt<T>(list: readonly T[] | undefined, index: number): T[] {
  const next = [...(list ?? [])];
  if (index >= 0 && index < next.length) next.splice(index, 1);
  return next;
}

function moveAt<T>(list: readonly T[] | undefined, from: number, to: number, fill: T): T[] {
  if (from === to || from < 0 || to < 0) return [...(list ?? [])];
  const next = [...(list ?? [])];
  while (next.length <= Math.max(from, to)) next.push(fill);
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** A definition inserted during the round is not part of this exercise. */
export function insertRoundSlots(round: PlayRound, index: number, count: number): PlayRound {
  if (count <= 0) return round;
  const blanks = Array.from({ length: count }, () => '');
  const flags = Array.from({ length: count }, () => false);
  const rewards = Array.from({ length: count }, (): EquivalentReward | null => null);
  const logs = Array.from({ length: count }, (): number | null => null);
  return {
    equivalentDrafts: insertAt(round.equivalentDrafts, index, blanks, ''),
    equivalentSubmitted: insertAt(round.equivalentSubmitted, index, flags, false),
    equivalentRewards: insertAt(round.equivalentRewards, index, rewards, null),
    equivalentLogIndexes: insertAt(round.equivalentLogIndexes, index, logs, null),
    definitionDrafts: insertAt(round.definitionDrafts, index, blanks, ''),
    definitionSupportDrafts: insertAt(round.definitionSupportDrafts, index, blanks, ''),
    definitionSubmitted: insertAt(round.definitionSubmitted, index, flags, false),
    definitionRewards: insertAt(round.definitionRewards, index, rewards, null),
    definitionLogIndexes: insertAt(round.definitionLogIndexes, index, logs, null),
    exampleDrafts: insertAt(round.exampleDrafts, index, blanks, ''),
    exampleSupportDrafts: insertAt(round.exampleSupportDrafts, index, blanks, ''),
    exampleSubmitted: insertAt(round.exampleSubmitted, index, flags, false),
    exampleRewards: insertAt(round.exampleRewards, index, rewards, null),
    exampleLogIndexes: insertAt(round.exampleLogIndexes, index, logs, null),
    included: round.included == null ? null : insertAt(round.included, index, flags, false),
    givenUp: round.givenUp,
  };
}

/** Drop the slot for a definition that left the card. */
export function removeRoundSlot(round: PlayRound, index: number): PlayRound {
  return {
    equivalentDrafts: removeAt(round.equivalentDrafts, index),
    equivalentSubmitted: removeAt(round.equivalentSubmitted, index),
    equivalentRewards: removeAt(round.equivalentRewards, index),
    equivalentLogIndexes: removeAt(round.equivalentLogIndexes, index),
    definitionDrafts: removeAt(round.definitionDrafts, index),
    definitionSupportDrafts: removeAt(round.definitionSupportDrafts, index),
    definitionSubmitted: removeAt(round.definitionSubmitted, index),
    definitionRewards: removeAt(round.definitionRewards, index),
    definitionLogIndexes: removeAt(round.definitionLogIndexes, index),
    exampleDrafts: removeAt(round.exampleDrafts, index),
    exampleSupportDrafts: removeAt(round.exampleSupportDrafts, index),
    exampleSubmitted: removeAt(round.exampleSubmitted, index),
    exampleRewards: removeAt(round.exampleRewards, index),
    exampleLogIndexes: removeAt(round.exampleLogIndexes, index),
    included: round.included == null ? null : removeAt(round.included, index),
    givenUp: round.givenUp,
  };
}

/** Keep this round's answers on the definition that moved. */
export function moveRoundSlot(round: PlayRound, from: number, to: number): PlayRound {
  if (from === to) return round;
  return {
    equivalentDrafts: moveAt(round.equivalentDrafts, from, to, ''),
    equivalentSubmitted: moveAt(round.equivalentSubmitted, from, to, false),
    equivalentRewards: moveAt(round.equivalentRewards, from, to, null),
    equivalentLogIndexes: moveAt(round.equivalentLogIndexes, from, to, null),
    definitionDrafts: moveAt(round.definitionDrafts, from, to, ''),
    definitionSupportDrafts: moveAt(round.definitionSupportDrafts, from, to, ''),
    definitionSubmitted: moveAt(round.definitionSubmitted, from, to, false),
    definitionRewards: moveAt(round.definitionRewards, from, to, null),
    definitionLogIndexes: moveAt(round.definitionLogIndexes, from, to, null),
    exampleDrafts: moveAt(round.exampleDrafts, from, to, ''),
    exampleSupportDrafts: moveAt(round.exampleSupportDrafts, from, to, ''),
    exampleSubmitted: moveAt(round.exampleSubmitted, from, to, false),
    exampleRewards: moveAt(round.exampleRewards, from, to, null),
    exampleLogIndexes: moveAt(round.exampleLogIndexes, from, to, null),
    included: round.included == null ? null : moveAt(round.included, from, to, false),
    givenUp: round.givenUp,
  };
}
