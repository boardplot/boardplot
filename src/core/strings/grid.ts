import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "maturingCohortNote": "Maturing cohorts have not had the full time to produce an outcome. Their scoped values are provisional.",
  "matureCohort": "Mature cohort",
  "provisional": "Provisional",
  "metricStack": "Metric stack",
  "metricStackWidth": "Metric stack needs {v1} px width.",
  "metricStackHeight": "Metric stack needs {v1} px height.",
  "sourceMeasures": "{v1} source measures",
  "metricStackTitle": "Metric stack of {v1} panels",
  "metricStackDesc": "Metric stack: {v1}. Top-down order: {v2}. Independent scales start at zero. {v3}",
  "gridPanelsTitle": "Grid of {v1} panels",
  "authoredRows": "Authored {v1}",
  "compositionColumns": "by {v1} composition",
  "gridComposition": "Authored {v1} by {v2} composition: {v3}.{v4}",
  "notesClause": " Notes: {v1}.",
  "legendName": "Legend",
  "legendItemsCount": "{v1} legend items.",
  "stackChangeMethod": "Change: average per {v1}, {v2} → {v3}; rates use volume weighting",
  "stackLeftMethod": "Left: volume-weighted mature rates and remaining per 100",
  "stackAboveMethod": "Above each panel: volume-weighted mature rates and remaining per 100",
  "notYetMature": "Not yet mature",
  "labelsShowTotals": "Labels show totals",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "maturingCohortNote": "Noch nicht ausgereifte Kohorten hatten nicht die volle Zeit für ein Ergebnis. Ihre Werte im angegebenen Bereich sind vorläufig.",
  "matureCohort": "Ausgereifte Kohorte",
  "provisional": "Vorläufig",
  "metricStack": "Kennzahlenstapel",
  "metricStackWidth": "Kennzahlenstapel braucht {v1} px Breite.",
  "metricStackHeight": "Kennzahlenstapel braucht {v1} px Höhe.",
  "sourceMeasures": "{v1} {v1|Quellkennzahl|Quellkennzahlen}",
  "metricStackTitle": "Kennzahlenstapel mit {v1} {v1|Feld|Feldern}",
  "metricStackDesc": "Kennzahlenstapel: {v1}. Reihenfolge von oben: {v2}. Unabhängige Skalen beginnen bei null. {v3}",
  "gridPanelsTitle": "Raster mit {v1} {v1|Feld|Feldern}",
  "authoredRows": "Angegeben: {v1}",
  "compositionColumns": "mal {v1} Anordnung",
  "gridComposition": "Angegebene Anordnung: {v1} mal {v2}: {v3}.{v4}",
  "notesClause": " Hinweise: {v1}.",
  "legendName": "Legende",
  "legendItemsCount": "{v1} {v1|Legendeneintrag|Legendeneinträge}.",
  "stackChangeMethod": "Änderung: Mittelwert je {v1}, {v2} → {v3}; Raten sind nach Volumen gewichtet",
  "stackLeftMethod": "Links: nach Volumen gewichtete ausgereifte Raten und Rest je 100",
  "stackAboveMethod": "Über jedem Feld: nach Volumen gewichtete ausgereifte Raten und Rest je 100",
  "notYetMature": "Noch nicht ausgereift",
  "labelsShowTotals": "Beschriftungen zeigen Summen",
};

export const { chartString } = chartStrings(EN, DE);
