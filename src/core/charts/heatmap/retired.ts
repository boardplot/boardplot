import type { RetiredSetting } from '../../retired';

/** The retired settings of heatmap: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.glyph', to: 'options.variant' },
];
