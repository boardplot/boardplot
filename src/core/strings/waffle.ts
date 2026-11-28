import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "panelsCount": "{v1} {v2}",
  "seriesCount": "{v1} series",
  "waffleCellsReading": "{v1} = {v2} of {v3} cells",
  "waffleWholeReading": "{v1} of the whole",
  "noValue": "no value",
  "noValueNote": "{na} = no value: {v1}",
  // the key line that names the dashed reference outline.
  "referenceKey": "Dashed outline = {label}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "panelsCount": "{v1} {v1|Feld|Felder}",
  "seriesCount": "{v1} {v1|Reihe|Reihen}",
  "waffleCellsReading": "{v1} = {v2} von {v3} {v3|Zelle|Zellen}",
  "waffleWholeReading": "{v1} des Ganzen",
  "noValue": "kein Wert",
  "noValueNote": "{na} = kein Wert: {v1}",
  // the key line that names the dashed reference outline.
  "referenceKey": "Gestrichelter Umriss = {label}",
};

export const { chartString } = chartStrings(EN, DE);
