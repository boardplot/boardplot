import type { RetiredSetting } from '../../retired';

/** The retired settings of dot: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.averageMarker.includePartial', use: 'A dot chart averages every dot in scope.' },
  { at: ['options.topN.threshold', 'options.topN.rest', 'options.topN.restLabel', 'options.topN.showRestCount'], use: 'A dot chart draws no rest bucket, because a sum of scores is not a score.' },
];
