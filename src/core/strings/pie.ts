import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "pieNegativeNote": "Not drawn (negative value, so no total shown): {v1}.",
  "pieName": "pie",
  "doughnutName": "doughnut",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "pieNegativeNote": "Nicht gezeichnet (negativer Wert, daher keine Summe): {v1}.",
  "pieName": "Kreis",
  "doughnutName": "Ring",
};

export const { chartString } = chartStrings(EN, DE);
