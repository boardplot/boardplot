import type { RetiredSetting } from '../../retired';

/** The retired settings of bartable: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.cascade', to: 'options.variant', values: { true: 'cascade' } },
  { at: 'options.panelScale', to: 'options.sharedScale', values: { own: false, shared: true } },
];
