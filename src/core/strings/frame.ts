import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
