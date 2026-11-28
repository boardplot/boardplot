import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "categoriesNotShown": "Not shown",
  "slopeNeedsTwoCategories": "A slope needs at least two categories (time points).",
  "slopeEndpointsOnly": "Slope draws the first category, '{v1}', and the last, '{v2}'. {v3}",
  "slopeResponseRest": "{v1} and {v2} do not add to 100: the rest ({v3} per group and period) chose neither answer.",
  "slopeNetName": "Net",
  "changeHead": "Change",
  "slopeNetKey": " = {v1} − {v2} in {v3} (change vs {v4})",
  "slopeFoldHead": "{v1}: the {v2} series below {v3} of the endpoint total at both ends ",
  "slopeFoldSum": "summed to {v1} at {v2} and ",
  "slopeFoldEnd": "{v1} at {v2}.",
  "positiveName": "Positive",
  "negativeName": "Negative",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "categoriesNotShown": "Nicht gezeigt",
  "slopeNeedsTwoCategories": "Ein Steigungsdiagramm braucht mindestens zwei Kategorien (Zeitpunkte).",
  "slopeEndpointsOnly": "Das Steigungsdiagramm zeigt die erste Kategorie, '{v1}', und die letzte, '{v2}'. {v3}",
  "slopeResponseRest": "{v1} und {v2} ergeben nicht 100. Der Rest ({v3} je Gruppe und Periode) wählte keine dieser Antworten.",
  "slopeNetName": "Netto",
  "changeHead": "Veränderung",
  "slopeNetKey": " = {v1} − {v2} in {v3} (Änderung vs {v4})",
  "slopeFoldHead": "{v1}: die {v2} {v2|Reihe|Reihen} unter {v3} der Endpunktsumme an beiden Enden ",
  "slopeFoldSum": "zusammen {v1} bei {v2} und ",
  "slopeFoldEnd": "{v1} bei {v2}.",
  "positiveName": "Positiv",
  "negativeName": "Negativ",
};

export const { chartString } = chartStrings(EN, DE);
