import { chartStrings } from '../strings';

export const EN = {
  "pointsCount": "{v1} point{v2}",
  "clippedPointsNote": "{v1} clipped at {v2} ({v3}).",
  "clippedAt": "clipped at {v1}",
} as const;

const DE: { [K in keyof typeof EN]: string } = {
  "pointsCount": "{v1} {v1|Punkt|Punkte}",
  "clippedPointsNote": "{v1} bei {v2} begrenzt ({v3}).",
  "clippedAt": "abgeschnitten bei {v1}",
};

export const { chartString } = chartStrings(EN, DE);
