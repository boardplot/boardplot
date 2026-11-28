import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "barPanelOne": "one stacked-bar panel",
  "barPanels": "{v1} stacked-bar panels",
  "partsMissTotal": "Parts print rounded, so the parts of a row can miss its printed total by one step.",
  "bartableBlankHeading": "{v1} marks a sum left blank because a part is missing",
  "bartableBlankTotal": "; the Total of that panel with it",
  "bartableMissingHeading": "{v1} marks a missing value",
  "cellNotApplicable": "n/a",
  "shareHeading": "Share",
  "shareChangeSpan": "{v1} share change, pp",
  "combinedShareZero": "share not defined: total is zero",
  "combinedShareNote": "{v1}: {v2} of {v3}{v4} of {v5} ({v6}).",
  "combinedShareRangeNote": "{v1}: {v2} of {v3}{v4} of {v5} at the low end ({v6}); {v7} of {v8}{v4} at the high end ({v9}).",
  // the note names the shaded rows; the compact cascade names its combined row.
  "combinedShadedLead": "Shaded rows, {v1}",
  "combinedRowLabel": "Top {v1} combined",
  "residualKey": "Rest rows",
  "sliverKnown": " ({v1} in the parts drawn)",
  "sliverNote": "Too short to compare on the shared{v1} scale, which runs to {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "barPanelOne": "einem Feld mit gestapelten Balken",
  "barPanels": "{v1} {v1|Feld|Feldern} mit gestapelten Balken",
  "partsMissTotal": "Die Teile sind gerundet, daher kann ihre Summe in einer Zeile um einen Schritt von der gezeigten Zeilensumme abweichen.",
  "bartableBlankHeading": "{v1} zeigt eine leere Summe, weil ein Teil fehlt",
  "bartableBlankTotal": "; ebenso die Summe dieses Felds",
  "bartableMissingHeading": "{v1} zeigt einen fehlenden Wert",
  "cellNotApplicable": "k. A.",
  "shareHeading": "Anteil",
  "shareChangeSpan": "{v1} Anteilsänderung, pp",
  "combinedShareZero": "Anteil nicht definiert: Summe ist null",
  "combinedShareNote": "{v1}: {v2} von {v3}{v4} in {v5} ({v6}).",
  "combinedShareRangeNote": "{v1}: {v2} von {v3}{v4} in {v5} an der unteren Grenze ({v6}); {v7} von {v8}{v4} an der oberen Grenze ({v9}).",
  // the note names the shaded rows; the compact cascade names its combined row.
  "combinedShadedLead": "Schattierte Zeilen, {v1}",
  "combinedRowLabel": "Top {v1} zusammen",
  "residualKey": "Übrige Zeilen",
  "sliverKnown": " ({v1} in den gezeichneten Teilen)",
  "sliverNote": "Zu kurz zum Vergleich auf der gemeinsamen Skala{v1} bis {v2}",
};

export const { chartString } = chartStrings(EN, DE);
