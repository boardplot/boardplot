import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "category": "Category",
  "group": "Group",
  "position": "Position",
  "top": "top",
  "left": "left",
  "diagramHierarchy": "hierarchy",
  "diagramIssueTree": "issue-tree",
  "diagramLinearProcess": "linear-process",
  "diagramCustomerJourney": "customer-journey",
  "diagramArchitecture": "architecture",
  "diagramCircularProcess": "circular-process",
  "diagramStrategyHouse": "strategy-house",
  "diagramRoadmap": "roadmap",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "category": "Kategorie",
  "group": "Gruppe",
  "position": "Position",
  "top": "oben",
  "left": "links",
  "diagramHierarchy": "Hierarchie",
  "diagramIssueTree": "Problembaum",
  "diagramLinearProcess": "Linearer Ablauf",
  "diagramCustomerJourney": "Kundenablauf",
  "diagramArchitecture": "Architektur",
  "diagramCircularProcess": "Kreisprozess",
  "diagramStrategyHouse": "Strategiehaus",
  "diagramRoadmap": "Zeitplan",
};

export const { chartString } = chartStrings(EN, DE);
