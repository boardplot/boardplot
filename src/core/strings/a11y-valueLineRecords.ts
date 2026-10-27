import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueLineName": "Value line",
  "valueLineValue": "Value",
  "valueLineMeasure": "Measure",
  "valueLineMeanOf": "Mean of {v1}",
  "valueLineMean": "Mean",
  "valueLineSpan": "{v1}, {v2} to {v3}",
  "valueLineTolerance": "Tolerance",
  "valueLineRange": "{v1} to {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueLineName": "Wertlinie",
  "valueLineValue": "Wert",
  "valueLineMeasure": "Messgröße",
  "valueLineMeanOf": "Mittelwert von {v1}",
  "valueLineMean": "Mittelwert",
  "valueLineSpan": "{v1}, {v2} bis {v3}",
  "valueLineTolerance": "Toleranz",
  "valueLineRange": "{v1} bis {v2}",
};

export const { chartString } = chartStrings(EN, DE);
