import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "dumbbellName": "Dumbbell",
  "lollipopName": "Lollipop",
  "clevelandName": "Cleveland dot",
  "rangeName": "Range",
  "gapHead": "Gap",
  "rose": "Rose",
  "fell": "Fell",
  "spanText": "{v1} to {v2}",
  "unchangedPair": "{v1} unchanged",
  // the key entry of a range mid-point marker and the note that names rows without one.
  "midName": "Midpoint",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "dumbbellName": "Hanteldiagramm",
  "lollipopName": "Stieldiagramm",
  "clevelandName": "Cleveland-Punktdiagramm",
  "rangeName": "Spanne",
  "gapHead": "Abstand",
  "rose": "Gestiegen",
  "fell": "Gefallen",
  "spanText": "{v1} bis {v2}",
  "unchangedPair": "{v1} unverändert",
  // the key entry of a range mid-point marker and the note that names rows without one.
  "midName": "Mittelwert",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
