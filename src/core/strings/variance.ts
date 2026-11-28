import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "aboveReference": "Above {v1}",
  "belowReference": "Below {v1}",
  "withinRounding": "Within rounding of {v1}",
  "varianceTone": "{v1} than {v2}{v3}",
  "betterCapital": "Better",
  "worseCapital": "Worse",
  "lower": "lower",
  "higher": "higher",
  "absoluteVariance": "absolute variance",
  "relativeVariance": "relative variance",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "aboveReference": "Über {v1}",
  "belowReference": "Unter {v1}",
  "withinRounding": "Innerhalb der Rundung von {v1}",
  "varianceTone": "{v1} als {v2}{v3}",
  "betterCapital": "Besser",
  "worseCapital": "Schlechter",
  "lower": "niedriger",
  "higher": "höher",
  "absoluteVariance": "absolute Varianz",
  "relativeVariance": "relative Varianz",
};

export const { chartString } = chartStrings(EN, DE);
