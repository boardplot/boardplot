import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "weekPrefix": "W",
  "quarterWord": "Quarter {n}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "weekPrefix": "KW ",
  "quarterWord": "Quartal {n}",
};

export const { chartString } = chartStrings(EN, DE);
