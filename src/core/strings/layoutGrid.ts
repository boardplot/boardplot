import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "notesClause": " Notes: {v1}.",
  "alignedExhibit": "Aligned multi-tier exhibit",
  "chartGrid": "Chart grid",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "notesClause": " Hinweise: {v1}.",
  "alignedExhibit": "Ausgerichtete Darstellung mit mehreren Ebenen",
  "chartGrid": "Diagrammraster",
};

export const { chartString } = chartStrings(EN, DE);
