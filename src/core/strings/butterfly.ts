import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "rowsNeedHeight": "The rows need a taller canvas.",
  "butterflyTitle": "Butterfly: {v1} vs {v2}",
  "butterflyDesc": "Butterfly chart comparing {v1} (left) and {v2} (right) across {v3} categories. {v4}.",
  "absoluteBarLengths": "bar length is the absolute value; a lighter bar is negative, its sign in the label",
  "independentNegativeScales": "Independent scales, {v1}.",
  "independentScalesNote": "Independent scales: bar lengths compare within a pane, not across it.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "rowsNeedHeight": "Die Zeilen brauchen eine höhere Zeichenfläche.",
  "butterflyTitle": "Schmetterlingsdiagramm: {v1} vs {v2}",
  "butterflyDesc": "Schmetterlingsdiagramm vergleicht {v1} (links) und {v2} (rechts) über {v3} {v3|Kategorie|Kategorien}. {v4}.",
  "absoluteBarLengths": "Balkenlänge ist der Betrag. Ein hellerer Balken ist negativ. Das Vorzeichen steht in der Beschriftung",
  "independentNegativeScales": "Unabhängige Skalen. {v1}.",
  "independentScalesNote": "Unabhängige Skalen: Balkenlängen sind innerhalb eines Felds vergleichbar, aber nicht zwischen Feldern.",
};

export const { chartString } = chartStrings(EN, DE);
