import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "lowerBetterHint": " · lower is better",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "lowerBetterHint": " · niedriger ist besser",
};

export const { chartString } = chartStrings(EN, DE);
