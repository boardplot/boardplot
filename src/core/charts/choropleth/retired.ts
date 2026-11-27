import type { RetiredSetting } from '../../retired';

/** The retired settings of choropleth: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'data.pack', values: { 'de-laender': 'de-states' } },
];
