import type { RetiredSetting } from '../../retired';

/** The retired settings of box: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  ...['options.valueAxis.includeZero', 'options.valueAxis.percent', 'options.valueAxis.reverse', 'options.valueAxis.tickStep'].map((at) => ({ at, use: 'A box axis is a plain linear read of the observations.' })),
];
