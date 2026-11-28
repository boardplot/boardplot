import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "observations": "Observations",
  "histogramBins": "{v1}{v2} bins of {v3} from {v4}",
  // The short default footer; the axis title leads it when set.
  // Whole-number data: one bin per value, so the footer names no edges.
  // The open last bin: its name under the bar carries the largest observation.
  "histogramOpenBin": "≥ {v1}",
  "histogramOpenBinMax": "≥ {v1} (max {v2})",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "observations": "Beobachtungen",
  "histogramBins": "{v1}{v2} {v2|Klasse|Klassen} der Breite {v3} ab {v4}",
  "histogramOpenBin": "≥ {v1}",
  "histogramOpenBinMax": "≥ {v1} (max. {v2})",
};

export const { chartString } = chartStrings(EN, DE);
