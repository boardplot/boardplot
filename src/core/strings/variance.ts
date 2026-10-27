import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "aboveReference": "Above {v1}",
  "belowReference": "Below {v1}",
  "withinRounding": "Within rounding of {v1}",
  "varianceTone": "{v1} than {v2}{v3}",
  "betterCapital": "Better",
  "worseCapital": "Worse",
  "lower": "lower",
  "higher": "higher",
  "varianceNmNote": "n.m.: not meaningful, {v1} is zero or negative; the change beside it is absolute{v2}.",
  "inUnitClause2": ", in {v1}",
  "varianceDesc": "{v1} {v2} chart vs {v3}, {v4} categories",
  "lowerBetterClause": " (lower is better)",
  "beyond": "beyond",
  "absoluteVariance": "absolute variance",
  "relativeVariance": "relative variance",
  "integratedVariance": "integrated variance",
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
  "varianceNmNote": "n.m.: nicht aussagekräftig, {v1} ist null oder negativ; die Änderung daneben ist absolut{v2}.",
  "inUnitClause2": ", in {v1}",
  "varianceDesc": "{v2}diagramm ({v1}) vs {v3}, {v4} {v4|Kategorie|Kategorien}",
  "lowerBetterClause": " (niedriger ist besser)",
  "beyond": "über",
  "absoluteVariance": "absolute Varianz",
  "relativeVariance": "relative Varianz",
  "integratedVariance": "integrierte Varianz",
};

export const { chartString } = chartStrings(EN, DE);
