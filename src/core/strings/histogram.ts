import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "observations": "Observations",
  "histogramBins": "{v1}{v2} bins of {v3} from {v4}",
  "about": "about ",
  // The short default footer; the axis title leads it when set.
  "histogramBinsShortTitled": "{v1} per {v2} bin, lower edge included",
  "histogramBinsShort": "Bins of {v1}, lower edge included",
  // Whole-number data: one bin per value, so the footer names no edges.
  "histogramPerValue": "One bin per value",
  "histogramPerValueTitled": "{v1} per value",
  "histogramPerValueRange": "one bin per value from {v1} to {v2}",
  // The open last bin: its name under the bar carries the largest observation.
  "histogramOpenBin": "≥ {v1}",
  "histogramOpenBinMax": "≥ {v1} (max {v2})",
  "histogramOpenClause": "open bin ≥ {v1}",
  "histogramOpenMethod": "{v1} bins of {v2} from {v3} ({v4}{v5}); each bin includes its lower bound; the open last bin holds every value of {v6} and above{v7}.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "observations": "Beobachtungen",
  "histogramBins": "{v1}{v2} {v2|Klasse|Klassen} der Breite {v3} ab {v4}",
  "about": "etwa ",
  "histogramBinsShortTitled": "{v1} je Klasse der Breite {v2}, untere Grenze eingeschlossen",
  "histogramBinsShort": "Klassen der Breite {v1}, untere Grenze eingeschlossen",
  "histogramPerValue": "Eine Klasse je Wert",
  "histogramPerValueTitled": "{v1} je Wert",
  "histogramPerValueRange": "eine Klasse je Wert von {v1} bis {v2}",
  "histogramOpenBin": "≥ {v1}",
  "histogramOpenBinMax": "≥ {v1} (max. {v2})",
  "histogramOpenClause": "offene Klasse ≥ {v1}",
  "histogramOpenMethod": "{v1} {v1|Klasse|Klassen} mit Breite {v2} ab {v3} ({v4}{v5}); jede Klasse enthält ihre untere Grenze; die offene letzte Klasse enthält alle Werte ab {v6}{v7}.",
};

export const { chartString } = chartStrings(EN, DE);
