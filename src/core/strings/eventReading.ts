import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "eventsSentence": " Events: {v1}.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "eventsSentence": " Ereignisse: {v1}.",
};

export const { chartString } = chartStrings(EN, DE);
