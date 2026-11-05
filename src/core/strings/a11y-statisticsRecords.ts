import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Value withheld",
  "group": "Group",
  "medianName": "Median",
  "quartiles": "Quartiles",
  "whiskers": "Whiskers",
  "observationsLower": "observations",
  "intervalAtLeast": "{v1} or more",
  "retentionNotMeaningful": "Retention is not meaningful for this period",
  "periodObservationMissing": "No observation for this period",
  "basis": "Basis",
  "cohortSizeLabel": "{v1} / cohort size",
  "region": "Region",
  "notMeaningful": "Not meaningful",
  "notApplicableName": "Not applicable",
  "spanText": "{v1} to {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Wert zurückgehalten",
  "group": "Gruppe",
  "medianName": "Median",
  "quartiles": "Quartile",
  "whiskers": "Antennen",
  "observationsLower": "Beobachtungen",
  "intervalAtLeast": "{v1} und mehr",
  "retentionNotMeaningful": "Bindung für diese Periode nicht aussagekräftig",
  "periodObservationMissing": "Keine Beobachtung für diese Periode",
  "basis": "Basis",
  "cohortSizeLabel": "{v1} / Kohortengröße",
  "region": "Region",
  "notMeaningful": "Nicht aussagekräftig",
  "notApplicableName": "Nicht anwendbar",
  "spanText": "{v1} bis {v2}",
};

export const { chartString } = chartStrings(EN, DE);
