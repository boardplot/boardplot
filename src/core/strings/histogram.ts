import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "observations": "Observations",
  "histogramBins": "{v1}{v2} bins of {v3} from {v4}",
  "about": "about ",
  // The short default footer; the axis title leads it when set.
  "histogramBinsShortTitled": "{v1} per {v2} bin, lower edge included",
  "histogramBinsShort": "Bins of {v1}, lower edge included",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "observations": "Beobachtungen",
  "histogramBins": "{v1}{v2} {v2|Klasse|Klassen} der Breite {v3} ab {v4}",
  "about": "etwa ",
  "histogramBinsShortTitled": "{v1} je Klasse der Breite {v2}, untere Grenze eingeschlossen",
  "histogramBinsShort": "Klassen der Breite {v1}, untere Grenze eingeschlossen",
};

export const { chartString } = chartStrings(EN, DE);
