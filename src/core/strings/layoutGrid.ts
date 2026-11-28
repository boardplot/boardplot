import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "notesClause": " Notes: {v1}.",
  "gridChartsTitle": "Grid of {v1} charts",
  "gridChartsDesc": "{v1}: {v2}.{v3}",
  "alignedExhibit": "Aligned multi-tier exhibit",
  "chartGrid": "Chart grid",
  "valueInCategory": "{series} in {category}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "notesClause": " Hinweise: {v1}.",
  "gridChartsTitle": "Raster mit {v1} {v1|Diagramm|Diagrammen}",
  "gridChartsDesc": "{v1}: {v2}.{v3}",
  "alignedExhibit": "Ausgerichtete Darstellung mit mehreren Ebenen",
  "chartGrid": "Diagrammraster",
  "valueInCategory": "{series} in {category}",
};

export const { chartString } = chartStrings(EN, DE);
