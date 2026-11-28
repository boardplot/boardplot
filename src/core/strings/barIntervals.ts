import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "footballMethodWithoutRange": "Method '{v1}' has no range and was left out.",
  "footballMethodsLeftOutNote": "Not shown (no range)",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "footballMethodWithoutRange": "Methode '{v1}' hat keine Spanne und wurde weggelassen.",
  "footballMethodsLeftOutNote": "Nicht gezeigt (keine Spanne)",
};

export const { chartString } = chartStrings(EN, DE);
