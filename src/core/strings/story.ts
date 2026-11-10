import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "storyStepDesc": "Story step {step} of {count}:",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "storyStepDesc": "Story-Schritt {step} von {count}:",
};

export const { chartString } = chartStrings(EN, DE);
