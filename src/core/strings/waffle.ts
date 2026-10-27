import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "waffleTitle": "Waffle chart: {v1}",
  "panelsCount": "{v1} {v2}",
  "seriesCount": "{v1} series",
  "waffleSquareDesc": "Waffle chart of share squares, {v1} {v2} and {v3} series: each panel is a square for 100%, and the area of its solid square is the share. {v4}{v5}",
  "waffleReferenceDesc": " A dashed outline in {v1} marks the reference, {v2}.",
  "otherPanels": "the other panels",
  "eachPanel": "each panel",
  "waffleCellsDesc": "Waffle chart, {v1} {v2} and {v3} series, each panel a {v4} × {v5} grid of {v6} cells; one cell is {v7}. {v8}",
  "waffleCellsReading": "{v1} = {v2} of {v3} cells",
  "waffleWholeReading": "{v1} of the whole",
  "noValue": "no value",
  "waffleAllClause": ", {v1} in all",
  "emptyCellsClause": ", {v1} of {v2} cells empty",
  // the key line that names the dashed reference outline.
  "referenceKey": "Dashed outline = {label}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "waffleTitle": "Waffeldiagramm: {v1}",
  "panelsCount": "{v1} {v1|Feld|Felder}",
  "seriesCount": "{v1} {v1|Reihe|Reihen}",
  "waffleSquareDesc": "Waffeldiagramm aus Anteilsquadraten, {v1} {v1|Feld|Felder} und {v3} {v3|Reihe|Reihen}. Jedes Feld ist ein Quadrat für 100 %. Die Fläche des gefüllten Quadrats zeigt den Anteil. {v4}{v5}",
  "waffleReferenceDesc": " Ein gestrichelter Umriss in {v1} zeigt die Referenz {v2}.",
  "otherPanels": "den anderen Feldern",
  "eachPanel": "jedem Feld",
  "waffleCellsDesc": "Waffeldiagramm mit {v1} {v1|Feld|Feldern} und {v3} {v3|Reihe|Reihen}. Jedes Feld hat {v4} × {v5} {v6|Zelle|Zellen}, insgesamt {v6}. Eine Zelle entspricht {v7}. {v8}",
  "waffleCellsReading": "{v1} = {v2} von {v3} {v3|Zelle|Zellen}",
  "waffleWholeReading": "{v1} des Ganzen",
  "noValue": "kein Wert",
  "waffleAllClause": ", {v1} insgesamt",
  "emptyCellsClause": ", {v1} von {v2} {v2|Zelle|Zellen} leer",
  // the key line that names the dashed reference outline.
  "referenceKey": "Gestrichelter Umriss = {label}",
};

export const { chartString } = chartStrings(EN, DE);
