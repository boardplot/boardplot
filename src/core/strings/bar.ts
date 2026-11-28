import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "groupedCapital": "Grouped",
  "stackedCapital": "Stacked",
  "stacked100": "100% stacked",
  "barTitle": "Bar chart: {v1} categories",
  "barDesc": "{v1} horizontal bar chart with {v2} series.{v3}",
  "rangesClause": " Ranges: {v1}.",
  "namedRange": "{v1} {v2} to {v3}",
  "footballRangeRequired": "A football field needs at least one method with a range.",
  "footballRangeSuggest": "Give at least one method a range with low and high values.",
  "gapLead": "gap",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "groupedCapital": "Gruppiert",
  "stackedCapital": "Gestapelt",
  "stacked100": "100 % gestapelt",
  "barTitle": "Balkendiagramm: {v1} {v1|Kategorie|Kategorien}",
  "barDesc": "Horizontales Balkendiagramm ({v1}) mit {v2} {v2|Reihe|Reihen}.{v3}",
  "rangesClause": " Spannen: {v1}.",
  "namedRange": "{v1} {v2} bis {v3}",
  "footballRangeRequired": "Ein Football-Field-Diagramm braucht mindestens eine Methode mit einer Spanne.",
  "footballRangeSuggest": "Geben Sie für mindestens eine Methode eine Spanne mit Unter- und Obergrenze an.",
  "gapLead": "Abstand",
};

export const { chartString } = chartStrings(EN, DE);
