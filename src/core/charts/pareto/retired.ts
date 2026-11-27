import type { RetiredSetting } from '../../retired';

/** The retired settings of pareto: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.ruler' },
  { at: 'options.highlight', use: 'The highlight encodes the derived vital few.' },
  { at: 'options.topN.showRestCount', use: 'A Pareto always prints the count, because the concentration verdict rests on it.' },
  { at: 'options.topN.threshold', use: 'The rank cut is topN.n.' },
];
