import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "category": "Category",
  "group": "Group",
  "position": "Position",
  "diagramTitle": "{v1} diagram",
  "diagramDesc": "{v1} diagram with {v2} nodes and {v3} relationships.",
  "readingOrder": "Reading order: {v1}.",
  "relationshipsSentence": "Relationships: {v1}.",
  "groupsSentence": "Groups: {v1}.",
  "lanesSentence": "Lanes: {v1}.",
  "top": "top",
  "left": "left",
  "right": "right",
  "milestone": "Milestone",
  "containsMembers": "{v1} contains {v2}",
  "noNodes": "no nodes",
  "diagramHierarchy": "hierarchy",
  "diagramIssueTree": "issue-tree",
  "diagramLinearProcess": "linear-process",
  "diagramCustomerJourney": "customer-journey",
  "diagramCircularProcess": "circular-process",
  "diagramStrategyHouse": "strategy-house",
  "diagramRoadmap": "roadmap",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "category": "Kategorie",
  "group": "Gruppe",
  "position": "Position",
  "diagramTitle": "Diagramm: {v1}",
  "diagramDesc": "Diagramm: {v1} mit {v2} Knoten und {v3} {v3|Beziehung|Beziehungen}.",
  "readingOrder": "Lesereihenfolge: {v1}.",
  "relationshipsSentence": "Beziehungen: {v1}.",
  "groupsSentence": "Gruppen: {v1}.",
  "lanesSentence": "Bahnen: {v1}.",
  "top": "oben",
  "left": "links",
  "right": "rechts",
  "milestone": "Meilenstein",
  "containsMembers": "{v1} enthält {v2}",
  "noNodes": "keine Knoten",
  "diagramHierarchy": "Hierarchie",
  "diagramIssueTree": "Problembaum",
  "diagramLinearProcess": "Linearer Ablauf",
  "diagramCustomerJourney": "Kundenablauf",
  "diagramCircularProcess": "Kreisprozess",
  "diagramStrategyHouse": "Strategiehaus",
  "diagramRoadmap": "Zeitplan",
};

export const { chartString } = chartStrings(EN, DE);
