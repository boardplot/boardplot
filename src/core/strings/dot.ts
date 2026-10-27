import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "dumbbellName": "Dumbbell",
  "lollipopName": "Lollipop",
  "clevelandName": "Cleveland dot",
  "dotRangeDesc": "{v1}, range {v2} to {v3}{v4}",
  "midpointClause": ", midpoint {v1}",
  "dotTitle": "{v1} chart: {v2} categories",
  "dotDesc": "{v1} chart with {v2} series. {v3}.",
  "rangeName": "Range",
  "rose": "Rose",
  "fell": "Fell",
  "spanText": "{v1} to {v2}",
  "unchangedPair": "{v1} unchanged",
  // the key entry of a range mid-point marker and the note that names rows without one.
  "midName": "Midpoint",
  "midMissing": "{v1} not reported for {v2}.",
  "midMissingCount": "{v1} not reported for {v2} rows.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "dumbbellName": "Hanteldiagramm",
  "lollipopName": "Stieldiagramm",
  "clevelandName": "Cleveland-Punktdiagramm",
  "dotRangeDesc": "{v1}, Spanne {v2} bis {v3}{v4}",
  "midpointClause": ", Mitte {v1}",
  "dotTitle": "{v1}: {v2} {v2|Kategorie|Kategorien}",
  "dotDesc": "{v1} mit {v2} {v2|Reihe|Reihen}. {v3}.",
  "rangeName": "Spanne",
  "rose": "Gestiegen",
  "fell": "Gefallen",
  "spanText": "{v1} bis {v2}",
  "unchangedPair": "{v1} unverändert",
  // the key entry of a range mid-point marker and the note that names rows without one.
  "midName": "Mittelwert",
  "midMissing": "{v1} für {v2} nicht angegeben.",
  "midMissingCount": "{v1} für {v2} {v2|Zeile|Zeilen} nicht angegeben.",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
