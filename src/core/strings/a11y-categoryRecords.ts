import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "date": "Date",
  "footnote": "Footnote",
  "shareOfTotal": "Share of total",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "date": "Datum",
  "footnote": "Fußnote",
  "shareOfTotal": "Anteil an der Summe",
};

export const { chartString } = chartStrings(EN, DE);
