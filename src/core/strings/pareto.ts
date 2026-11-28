import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "valueName": "Value",
  "cumulative": "Cumulative",
  "paretoUnlabelled": "Columns with no room for a label, by rank: {v1}.",
  "sortedCauses": "{v1} causes sorted descending",
  "firstCount": "The first {v1}",
  "causesOfCount": "{v1} of {v2} causes",
  "smallerCauses": "{v1} smaller causes",
  "paretoHighlightNote": "Highlighted: the {v1} of {v2} that together reach the {v3} reference ({v4} of {v5}).",
  "paretoHiddenHighlights": " {v1} of those causes sit inside {v2} and carry no highlight of their own.",
  "paretoReferenceConvention": " The reference is a convention, not a property of the data.",
  "paretoNoReachNote": "No concentration: the named causes do not reach {v1} of the total, so no vital few is highlighted.",
  "paretoNoConcentrationNote": "No concentration: {v1} of {v2} are needed to reach {v3}, so no vital few is highlighted. The {v4} reference is a convention, not a property of the data.",
  "paretoRestMethod": "The authored rest counts in the total and is excluded from ranking. Concentration is computed over the named causes.",
  "paretoFoldedMethod": "{v1}: the {v2} smallest causes, {v3} in total, plotted {v4} and counted in the grand total and in the {v5}-cause denominator above.",
  "insideRest": "inside the authored rest",
  "lastRegardlessSize": "last regardless of size",
  "cumulativeAxis": "Cumulative share, %",
  // the curve's line item in the highlight key.
  "cumulativeKey": "Cumulative %",
  "observedCausesDrawn": "{v1} observed causes (drawn as {v2} columns)",
  "observedCauses": "{v1} observed causes",
  "paretoNoThresholdNote": "No threshold reference is drawn, so no vital few is highlighted.",
  "cumulativeMethodNote": "Cumulative share (right axis) is derived from the plotted values; 100% is the grand total.",
  "cumulativeOffNote": "The cumulative curve, its threshold reference and the share axis are off.",
  "paretoTop": "Top {v1}{v2}",
  "outsideTop": "Outside top {v1}",
  "numberCount": "{v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueName": "Wert",
  "cumulative": "Kumuliert",
  "paretoUnlabelled": "Säulen ohne Beschriftung, nach Rang: {v1}.",
  "sortedCauses": "{v1} {v1|Ursache|Ursachen} absteigend geordnet",
  "firstCount": "Die ersten {v1}",
  "causesOfCount": "{v1} von {v2} {v2|Ursache|Ursachen}",
  "smallerCauses": "{v1} {v1|kleinere Ursache|kleinere Ursachen}",
  "paretoHighlightNote": "Hervorgehoben: {v1} von {v2} {v1|erreicht|erreichen} zusammen die Referenz {v3} ({v4} von {v5}).",
  "paretoHiddenHighlights": " {v1} dieser Ursachen {v1|steht|stehen} in {v2} und {v1|hat|haben} keine eigene Hervorhebung.",
  "paretoReferenceConvention": " Die Referenz ist eine Konvention, keine Eigenschaft der Daten.",
  "paretoNoReachNote": "Keine Konzentration: Die benannten Ursachen erreichen {v1} der Summe nicht. Keine wesentlichen Ursachen hervorgehoben.",
  "paretoNoConcentrationNote": "Keine Konzentration: {v1} von {v2} {v1|ist|sind} für {v3} nötig. Keine wesentlichen Ursachen hervorgehoben. Die Referenz {v4} ist eine Konvention, keine Eigenschaft der Daten.",
  "paretoRestMethod": "Der angegebene Rest zählt zur Summe und wird nicht in die Rangfolge aufgenommen. Die Konzentration wird über die benannten Ursachen berechnet.",
  "paretoFoldedMethod": "{v1}: die {v2} {v2|kleinste Ursache|kleinsten Ursachen}, insgesamt {v3}, gezeichnet {v4} und in der Gesamtsumme sowie den oben genannten {v5} {v5|Ursache|Ursachen} enthalten.",
  "insideRest": "im angegebenen Rest",
  "lastRegardlessSize": "zuletzt, unabhängig von der Größe",
  "cumulativeAxis": "Kumulierter Anteil, %",
  // The curve's line item in the highlight key.
  "cumulativeKey": "Kumuliert in %",
  "observedCausesDrawn": "{v1} {v1|beobachtete Ursache|beobachtete Ursachen} (als {v2} {v2|Säule|Säulen} gezeichnet)",
  "observedCauses": "{v1} {v1|beobachtete Ursache|beobachtete Ursachen}",
  "paretoNoThresholdNote": "Keine Schwellenreferenz gezeichnet. Keine wesentlichen Ursachen hervorgehoben.",
  "cumulativeMethodNote": "Der kumulierte Anteil (rechte Achse) wird aus den gezeigten Werten berechnet. 100 % ist die Gesamtsumme.",
  "cumulativeOffNote": "Die kumulierte Kurve, ihre Schwellenreferenz und die Anteilsachse sind aus.",
  "paretoTop": "Oberste {v1}{v2}",
  "outsideTop": "Außerhalb der obersten {v1}",
  "numberCount": "{v1}",
};

export const { chartString } = chartStrings(EN, DE);
