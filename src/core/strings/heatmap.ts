import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "noData": "No data",
  "hatchedNoData": "Hatched cells: no data.",
  "hatchedCells": "Hatched cells: {v1}.",
  "stateSuppressed": "Suppressed",
  "stateNm": "Not meaningful",
  "stateNa": "Not applicable",
  // The note under a bubble matrix that prints values in its largest circles only.
  // The callout under a value matrix whose story value has no room in its cell ("Aug low").
  "heatmapLeadLow": "{v1} low",
  "heatmapLeadHigh": "{v1} high",
  "blankCells": "Blank cells: {v1}.",
  "blankNoData": "Blank cells: no data.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "noData": "Keine Daten",
  "hatchedNoData": "Schraffierte Zellen: keine Daten.",
  "hatchedCells": "Schraffierte Zellen: {v1}.",
  "stateSuppressed": "Zurückgehalten",
  "stateNm": "Nicht aussagekräftig",
  "stateNa": "Nicht anwendbar",
  // The note under a bubble matrix that prints values in its largest circles only.
  "heatmapLeadLow": "{v1} Tief",
  "heatmapLeadHigh": "{v1} Hoch",
  "blankCells": "Leere Zellen: {v1}.",
  "blankNoData": "Leere Zellen: keine Daten.",
};

export const { chartString } = chartStrings(EN, DE);
