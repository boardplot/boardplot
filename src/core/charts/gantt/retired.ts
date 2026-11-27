import type { RetiredSetting } from '../../retired';

/** The retired settings of gantt: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.format', use: 'Gantt formats calendar dates through its date options.' },
];
