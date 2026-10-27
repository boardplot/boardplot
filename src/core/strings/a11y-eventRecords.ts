import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "date": "Date",
  "category": "Category",
  "recordKind": "Kind",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "date": "Datum",
  "category": "Kategorie",
  "recordKind": "Art",
};

export const { chartString } = chartStrings(EN, DE);
