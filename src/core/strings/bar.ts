import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "footballRangeRequired": "A football field needs at least one method with a range.",
  "footballRangeSuggest": "Give at least one method a range with low and high values.",
  "gapLead": "gap",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "footballRangeRequired": "Ein Football-Field-Diagramm braucht mindestens eine Methode mit einer Spanne.",
  "footballRangeSuggest": "Geben Sie für mindestens eine Methode eine Spanne mit Unter- und Obergrenze an.",
  "gapLead": "Abstand",
};

export const { chartString } = chartStrings(EN, DE);
