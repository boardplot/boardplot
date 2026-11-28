import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "reasonSegmentOperandsNotRetained": "Segment operands not retained",
  "reasonReferenceIsNonpositive": "Reference is nonpositive",
  "reasonValueOrTargetMissing": "Value or target missing",
  "reasonPositiveReferenceAndValueRequired": "Positive reference and value required",
  "reasonNonzeroCompositionBasisRequired": "Nonzero composition basis required",
  "reasonNoSourceCategoryForThisMark": "No source category for this mark",
  "reasonASignedCompositionHasNoShareOfANonnegativeTotal": "A signed composition has no share of a nonnegative total",
  "reasonShareRequiresAPositiveTotal": "Share requires a positive total",
  "reasonTheObservationIsUnavailable": "The observation is unavailable",
  "reasonCurrentTotalCombinesIncompatibleUnits": "Current total combines incompatible units",
  "reasonRelativeChangeRequiresAPositiveReference": "Relative change requires a positive reference",
  "reasonNoObservation": "No observation",
  "reasonNoObservationDrawnAsZeroInTheStack": "No observation; drawn as 0 in the stack",
  "reasonNonfiniteValue": "Non-finite value",
  "reasonIncompatibleUnits": "Incompatible units",
  "reasonAComparisonOperandIsUnavailable": "A comparison operand is unavailable",
  "reasonComparisonRequiresNumericValues": "Comparison requires numeric values",
  "reasonRelativeChangeIsNotMeaningfulForANonpositiveReference": "Relative change is not meaningful for a nonpositive reference",
  "reasonMoreThanOneComparisonScenario": "More than one series has this comparison scenario",
  "reasonComparisonDifferentAxis": "Comparison uses a different axis",
  "reasonStackedComponentNoReference": "A stacked component has no per-component comparison reference",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "reasonSegmentOperandsNotRetained": "Segmentwerte nicht gespeichert",
  "reasonReferenceIsNonpositive": "Referenz ist nicht positiv",
  "reasonValueOrTargetMissing": "Wert oder Ziel fehlt",
  "reasonPositiveReferenceAndValueRequired": "Positive Referenz und positiver Wert erforderlich",
  "reasonNonzeroCompositionBasisRequired": "Basis der Zusammensetzung darf nicht null sein",
  "reasonNoSourceCategoryForThisMark": "Keine Quellkategorie für diese Marke",
  "reasonASignedCompositionHasNoShareOfANonnegativeTotal": "Eine Zusammensetzung mit Vorzeichen hat keinen Anteil an einer nichtnegativen Summe",
  "reasonShareRequiresAPositiveTotal": "Anteil braucht eine positive Summe",
  "reasonTheObservationIsUnavailable": "Beobachtung nicht verfügbar",
  "reasonCurrentTotalCombinesIncompatibleUnits": "Aktuelle Summe enthält unvereinbare Einheiten",
  "reasonRelativeChangeRequiresAPositiveReference": "Relative Änderung braucht eine positive Referenz",
  "reasonNoObservation": "Keine Beobachtung",
  "reasonNoObservationDrawnAsZeroInTheStack": "Keine Beobachtung; im Stapel als 0 gezeichnet",
  "reasonNonfiniteValue": "Nichtendlicher Wert",
  "reasonIncompatibleUnits": "Unvereinbare Einheiten",
  "reasonAComparisonOperandIsUnavailable": "Ein Vergleichswert ist nicht verfügbar",
  "reasonComparisonRequiresNumericValues": "Vergleich braucht Zahlenwerte",
  "reasonRelativeChangeIsNotMeaningfulForANonpositiveReference": "Relative Änderung bei einer nichtpositiven Referenz nicht aussagekräftig",
  "reasonMoreThanOneComparisonScenario": "Mehr als eine Reihe hat dieses Vergleichsszenario",
  "reasonComparisonDifferentAxis": "Vergleich nutzt eine andere Achse",
  "reasonStackedComponentNoReference": "Ein gestapelter Teil hat keine eigene Vergleichsreferenz",
};

export const { chartString } = chartStrings(EN, DE);

const reasonKeys = ["reasonSegmentOperandsNotRetained","reasonReferenceIsNonpositive","reasonValueOrTargetMissing","reasonPositiveReferenceAndValueRequired","reasonNonzeroCompositionBasisRequired","reasonNoSourceCategoryForThisMark","reasonASignedCompositionHasNoShareOfANonnegativeTotal","reasonShareRequiresAPositiveTotal","reasonTheObservationIsUnavailable","reasonCurrentTotalCombinesIncompatibleUnits","reasonRelativeChangeRequiresAPositiveReference","reasonNoObservation","reasonNoObservationDrawnAsZeroInTheStack","reasonNonfiniteValue","reasonIncompatibleUnits","reasonAComparisonOperandIsUnavailable","reasonComparisonRequiresNumericValues","reasonRelativeChangeIsNotMeaningfulForANonpositiveReference","reasonMoreThanOneComparisonScenario","reasonComparisonDifferentAxis","reasonStackedComponentNoReference"] as const;
let reasonByEnglish: Map<string, typeof reasonKeys[number]> | undefined;
export function localizedRecordReason(reason: string, language?: string): string {
  const key = (reasonByEnglish ??= new Map(reasonKeys.map(key => [EN[key], key]))).get(reason);
  return key === undefined ? reason : chartString({ locale: { language } }, key);
}
