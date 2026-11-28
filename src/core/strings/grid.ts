import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "matureCohort": "Mature cohort",
  "provisional": "Provisional",
  "metricStack": "Metric stack",
  "sourceMeasures": "{v1} source measures",
  "authoredRows": "Authored {v1}",
  "compositionColumns": "by {v1} composition",
  "legendName": "Legend",
  "stackChangeMethod": "Change: average per {v1}, {v2} → {v3}; rates use volume weighting",
  "stackAverageMethod": "Average per {v1}, {v2} → {v3}; rates use volume weighting",
  "stackLeftMethod": "Left: volume-weighted mature rates and remaining per 100",
  "stackRightMethod": "Right: volume-weighted mature rates and remaining per 100",
  "stackAboveMethod": "Above each panel: volume-weighted mature rates and remaining per 100",
  "stackLeftRemaining": "Left: remaining per 100",
  "stackRightRemaining": "Right: remaining per 100",
  "stackAboveRemaining": "Above each panel: remaining per 100",
  "notYetMature": "Not yet mature",
  "labelsShowTotals": "Labels show totals",
  "stackFrom": "from {v1}",
  "stackAgainst": "against",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "matureCohort": "Ausgereifte Kohorte",
  "provisional": "Vorläufig",
  "metricStack": "Kennzahlenstapel",
  "sourceMeasures": "{v1} {v1|Quellkennzahl|Quellkennzahlen}",
  "authoredRows": "Angegeben: {v1}",
  "compositionColumns": "mal {v1} Anordnung",
  "legendName": "Legende",
  "stackChangeMethod": "Änderung: Mittelwert je {v1}, {v2} → {v3}; Raten sind nach Volumen gewichtet",
  "stackAverageMethod": "Mittelwert je {v1}, {v2} → {v3}; Raten sind nach Volumen gewichtet",
  "stackLeftMethod": "Links: nach Volumen gewichtete ausgereifte Raten und Rest je 100",
  "stackRightMethod": "Rechts: nach Volumen gewichtete ausgereifte Raten und Rest je 100",
  "stackAboveMethod": "Über jedem Feld: nach Volumen gewichtete ausgereifte Raten und Rest je 100",
  "stackLeftRemaining": "Links: Rest je 100",
  "stackRightRemaining": "Rechts: Rest je 100",
  "stackAboveRemaining": "Über jedem Feld: Rest je 100",
  "notYetMature": "Noch nicht ausgereift",
  "labelsShowTotals": "Beschriftungen zeigen Summen",
  "stackFrom": "von {v1}",
  "stackAgainst": "gegenüber",
};

export const { chartString } = chartStrings(EN, DE);
