import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "showingPeriods": "Showing {v1} of {v2} periods{v3}",
  "minmaxSampled": " · min-max sampled",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "showingPeriods": "Zeigt {v1} von {v2} {v2|Periode|Perioden}{v3}",
  "minmaxSampled": " · Min-Max-Stichprobe",
};

export const { chartString } = chartStrings(EN, DE);
