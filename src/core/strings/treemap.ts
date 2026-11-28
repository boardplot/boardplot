import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "treemapItemLeftOut": "Item '{v1}' was left out: value {v2} gives no cell area.",
  "treemapLeftOutNote": "Not drawn (no value above 0)",
  "treemapNegativeValue": "Treemap value {v1} for '{v2}' is negative: a cell area is its value, so a negative value cannot be drawn.",
  "treemapNoPositiveValues": "A treemap needs at least one item with a value above 0.",
  // the lead of the circle treemap note that lists unnamed cells.
  "treemapCircleHiddenLead": "Too small to label",
  // the lead of the rect treemap note that lists unnamed cells.
  "treemapRectHiddenLead": "Smaller items",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "treemapItemLeftOut": "Posten '{v1}' wurde weggelassen: Der Wert {v2} ergibt keine Zellfläche.",
  "treemapLeftOutNote": "Nicht gezeichnet (kein Wert über 0)",
  "treemapNegativeValue": "Der Flächenbaumwert {v1} für '{v2}' ist negativ: Die Zellfläche entspricht dem Wert, daher kann ein negativer Wert nicht gezeichnet werden.",
  "treemapNoPositiveValues": "Ein Flächenbaum braucht mindestens einen Posten mit einem Wert über 0.",
  // the lead of the circle treemap note that lists unnamed cells.
  "treemapCircleHiddenLead": "Zu klein für eine Beschriftung",
  // the lead of the rect treemap note that lists unnamed cells.
  "treemapRectHiddenLead": "Kleinere Posten",
};

export const { chartString } = chartStrings(EN, DE);
