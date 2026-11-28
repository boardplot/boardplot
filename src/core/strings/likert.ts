import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "disagreeSide": "the disagree side",
  "agreeSide": "the agree side",
  "agreementBoundary": "the boundary between agreement and disagreement",
  "onNamedSide": "on the '{v1}' side",
  "namedSide": "the '{v1}' side",
  "twoSidesBoundary": "the boundary between the two sides",
  "statementsCount": "{v1} statement{v2}",
  "scalePointsCount": "{v1}-point scale",
  "likertNeutralExcluded": "'{v1}' is excluded from the bars, which therefore do not sum to each statement's base: {v2}.",
  "disagreeLower": "disagree",
  "agreeLower": "agree",
  "netPp": "Net, pp",
  "baseHead": "n",
  "baseShared": "n = {v1}",
  // The one-line net note of an agreement scale.
  // One line instead of the list of shares not printed.
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "disagreeSide": "die Ablehnungsseite",
  "agreeSide": "die Zustimmungsseite",
  "agreementBoundary": "die Grenze zwischen Zustimmung und Ablehnung",
  "onNamedSide": "auf der Seite '{v1}'",
  "namedSide": "die Seite '{v1}'",
  "twoSidesBoundary": "die Grenze zwischen den beiden Seiten",
  "statementsCount": "{v1} {v1|Aussage|Aussagen}",
  "scalePointsCount": "Skala mit {v1} {v1|Punkt|Punkten}",
  "likertNeutralExcluded": "'{v1}' fehlt in den Balken. Sie ergeben daher nicht die Basis jeder Aussage: {v2}.",
  "disagreeLower": "Ablehnung",
  "agreeLower": "Zustimmung",
  "netPp": "Netto, pp",
  "baseHead": "n",
  "baseShared": "n = {v1}",
  // The one-line net note of an agreement scale.
};

export const { chartString } = chartStrings(EN, DE);
