import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "endingAt": ", ending at {v1}",
  "unchanged": "unchanged",
  "kpiTitle": "KPI: {v1}",
  "up": "up",
  "down": "down",
  "kpiSparkDesc": ". Trend over {v1} periods{v2}",
  "attainmentNonpositive": ", {v1} attainment not meaningful because the reference is nonpositive",
  "lowerBetterHint": " · lower is better",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "endingAt": " mit Endwert {v1}",
  "unchanged": "unverändert",
  "kpiTitle": "KPI: {v1}",
  "up": "gestiegen",
  "down": "gefallen",
  "kpiSparkDesc": ". Verlauf über {v1} {v1|Periode|Perioden}{v2}",
  "attainmentNonpositive": ", Zielerreichung {v1} nicht aussagekräftig, da die Referenz nicht positiv ist",
  "lowerBetterHint": " · niedriger ist besser",
};

export const { chartString } = chartStrings(EN, DE);
