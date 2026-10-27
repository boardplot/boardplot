import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "lowCase": "Low case",
  "highCase": "High case",
  "baseCaseName": "Base case",
  "current": "Current",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "lowCase": "Niedriger Fall",
  "highCase": "Hoher Fall",
  "baseCaseName": "Basisfall",
  "current": "Aktuell",
};

export const { chartString } = chartStrings(EN, DE);
