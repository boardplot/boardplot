import type { RetiredSetting } from '../../retired';

/** The retired settings of likert: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.requiredNotes.base' },
  { at: 'options.legend.order', use: 'The legend reads in scale order. Reorder data.scale.' },
];
