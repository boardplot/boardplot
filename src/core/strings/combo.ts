import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} reference series",
  "stackedColumnSeriesCount": "{v1} stacked column series",
  "lineAreaSeriesCount": "{v1} line/area series",
  "columnsRankNote": "Columns by rank ({v1}): {v2}.",
  // the note under a dual-scale combo that prints no tick columns.
  "comboOwnScale": "Each series on its own scale.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} {v1|Referenzreihe|Referenzreihen}",
  "stackedColumnSeriesCount": "{v1} {v1|gestapelte Säulenreihe|gestapelte Säulenreihen}",
  "lineAreaSeriesCount": "{v1} {v1|Linien-/Flächenreihe|Linien-/Flächenreihen}",
  "columnsRankNote": "Säulen nach Rang ({v1}): {v2}.",
  // the note under a dual-scale combo that prints no tick columns.
  "comboOwnScale": "Jede Reihe hat ihre eigene Skala.",
};

export const { chartString } = chartStrings(EN, DE);
