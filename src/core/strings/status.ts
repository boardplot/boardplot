import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "noStatus": "No status",
  "noStatusCount": "No status {v1}",
  "statusTitle": "Status matrix: {v1} by {v2}",
  "statusDesc": "Categorical status matrix, {v1} rows by {v2} columns. {v3}.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "noStatus": "Kein Status",
  "noStatusCount": "Kein Status {v1}",
  "statusTitle": "Statusmatrix: {v1} mal {v2}",
  "statusDesc": "Kategorische Statusmatrix, {v1} {v1|Zeile|Zeilen} mal {v2} {v2|Spalte|Spalten}. {v3}.",
};

export const { chartString } = chartStrings(EN, DE);
