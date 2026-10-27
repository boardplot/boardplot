import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "eventPeriod": "{v1}, period",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "eventPeriod": "{v1}, Zeitraum",
};

export const { chartString } = chartStrings(EN, DE);
