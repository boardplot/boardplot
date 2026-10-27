import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "sparklineName": "Sparkline",
  "sparklineDesc": "Trend over {v1} points{v2}{v3}.",
  "endingAt": ", ending at {v1}",
  "referenceClause": ", reference {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "sparklineName": "Minidiagramm",
  "sparklineDesc": "Verlauf über {v1} {v1|Punkt|Punkte}{v2}{v3}.",
  "endingAt": " mit Endwert {v1}",
  "referenceClause": " mit Referenz {v1}",
};

export const { chartString } = chartStrings(EN, DE);
