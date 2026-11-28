import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "barPanelOne": "one stacked-bar panel",
  "barPanels": "{v1} stacked-bar panels",
  "bartableBlankHeading": "{v1} marks a sum left blank because a part is missing",
  "bartableBlankTotal": "; the Total of that panel with it",
  "bartableMissingHeading": "{v1} marks a missing value",
  "cellNotApplicable": "n/a",
  "shareHeading": "Share",
  "shareChangeSpan": "{v1} share change, pp",
  // the note names the shaded rows; the compact cascade names its combined row.
  "combinedRowLabel": "Top {v1} combined",
  "residualKey": "Rest rows",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "barPanelOne": "einem Feld mit gestapelten Balken",
  "barPanels": "{v1} {v1|Feld|Feldern} mit gestapelten Balken",
  "bartableBlankHeading": "{v1} zeigt eine leere Summe, weil ein Teil fehlt",
  "bartableBlankTotal": "; ebenso die Summe dieses Felds",
  "bartableMissingHeading": "{v1} zeigt einen fehlenden Wert",
  "cellNotApplicable": "k. A.",
  "shareHeading": "Anteil",
  "shareChangeSpan": "{v1} Anteilsänderung, pp",
  // the note names the shaded rows; the compact cascade names its combined row.
  "combinedRowLabel": "Top {v1} zusammen",
  "residualKey": "Übrige Zeilen",
};

export const { chartString } = chartStrings(EN, DE);
