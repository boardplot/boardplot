import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "absoluteBarLengths": "bar length is the absolute value; a lighter bar is negative, its sign in the label",
  "independentNegativeScales": "Independent scales, {v1}.",
  "independentScalesNote": "Independent scales: bar lengths compare within a pane, not across it.",
  "butterflyName": "Butterfly",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "absoluteBarLengths": "Balkenlänge ist der Betrag. Ein hellerer Balken ist negativ. Das Vorzeichen steht in der Beschriftung",
  "independentNegativeScales": "Unabhängige Skalen. {v1}.",
  "independentScalesNote": "Unabhängige Skalen: Balkenlängen sind innerhalb eines Felds vergleichbar, aber nicht zwischen Feldern.",
  "butterflyName": "Schmetterlingsdiagramm",
};

export const { chartString } = chartStrings(EN, DE);
