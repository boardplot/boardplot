import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "treemapDesc": "Treemap, {v1}, {v2} cells{v3}, total {v4}. ",
  "circular": "circular",
  "rectangular": "rectangular",
  "groupsClause": " in {v1} groups",
  "treemapTitle": "Treemap: {v1} cells, total {v2}",
  // the lead of the circle treemap note that lists unnamed cells.
  "treemapCircleHiddenLead": "Too small to label",
  // the lead of the rect treemap note that lists unnamed cells.
  "treemapRectHiddenLead": "Smaller items",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "treemapDesc": "Flächenbaum, {v1}, {v2} {v2|Zelle|Zellen}{v3}, Summe {v4}. ",
  "circular": "kreisförmig",
  "rectangular": "rechteckig",
  "groupsClause": " in {v1} {v1|Gruppe|Gruppen}",
  "treemapTitle": "Flächenbaum: {v1} {v1|Zelle|Zellen}, Summe {v2}",
  // the lead of the circle treemap note that lists unnamed cells.
  "treemapCircleHiddenLead": "Zu klein für eine Beschriftung",
  // the lead of the rect treemap note that lists unnamed cells.
  "treemapRectHiddenLead": "Kleinere Posten",
};

export const { chartString } = chartStrings(EN, DE);
