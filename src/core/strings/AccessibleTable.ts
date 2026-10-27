import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "category": "Category",
  "showDataTable": "Show data table",
  "hideDataTable": "Hide data table",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "category": "Kategorie",
  "showDataTable": "Datentabelle zeigen",
  "hideDataTable": "Datentabelle verbergen",
};

export const { chartString } = chartStrings(EN, DE);
