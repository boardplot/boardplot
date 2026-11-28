import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} reference series",
  "stacked100": "100% stacked",
  "rangesClause": " Ranges: {v1}.",
  "namedRange": "{v1} {v2} to {v3}",
  "noFlaggedPeriod": "No period is flagged.",
  "noFlaggedPeriodClause": " No period flagged.",
  "priorYearKey": "PY",
  "anomalyCountOf": "{v1} of the",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "referenceSeriesCount": "{v1} {v1|Referenzreihe|Referenzreihen}",
  "stacked100": "100 % gestapeltes",
  "rangesClause": " Spannen: {v1}.",
  "namedRange": "{v1} {v2} bis {v3}",
  "noFlaggedPeriod": "Keine Periode markiert.",
  "noFlaggedPeriodClause": " Keine Periode markiert.",
  "priorYearKey": "PY",
  "anomalyCountOf": "{v1} von",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
