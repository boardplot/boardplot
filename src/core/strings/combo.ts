import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} reference series",
  "stackedColumnSeriesDesc": "{v1} stacked column series ({v2})",
  "lineAreaSeriesDesc": "{v1} line/area series ({v2})",
  "plusClause": " plus ",
  "comboDescStart": "Combo chart, {v1} categories: {v2}",
  "secondaryAxisDesc": ". Line series on an acknowledged secondary axis",
  "columnTotalsSentence": ". Column totals: {v1}.",
  "comboTitle": "Combo chart: {v1} by {v2} categories",
  "stackedColumnSeriesCount": "{v1} stacked column series",
  "lineAreaSeriesCount": "{v1} line/area series",
  "columnsRankNote": "Columns by rank ({v1}): {v2}.",
  // the note under a dual-scale combo that prints no tick columns.
  "comboOwnScale": "Each series on its own scale.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} {v1|Referenzreihe|Referenzreihen}",
  "stackedColumnSeriesDesc": "{v1} {v1|gestapelte Säulenreihe|gestapelte Säulenreihen} ({v2})",
  "lineAreaSeriesDesc": "{v1} {v1|Linien-/Flächenreihe|Linien-/Flächenreihen} ({v2})",
  "plusClause": " plus ",
  "comboDescStart": "Kombinationsdiagramm, {v1} {v1|Kategorie|Kategorien}: {v2}",
  "secondaryAxisDesc": ". Linienreihen auf einer bestätigten zweiten Achse",
  "columnTotalsSentence": ". Säulensummen: {v1}.",
  "comboTitle": "Kombinationsdiagramm: {v1} nach {v2} {v2|Kategorie|Kategorien}",
  "stackedColumnSeriesCount": "{v1} {v1|gestapelte Säulenreihe|gestapelte Säulenreihen}",
  "lineAreaSeriesCount": "{v1} {v1|Linien-/Flächenreihe|Linien-/Flächenreihen}",
  "columnsRankNote": "Säulen nach Rang ({v1}): {v2}.",
  // the note under a dual-scale combo that prints no tick columns.
  "comboOwnScale": "Jede Reihe hat ihre eigene Skala.",
};

export const { chartString } = chartStrings(EN, DE);
