import type { RetiredSetting } from '../../retired';

/** The retired settings of dimswitch: each is accepted for good and warns `option-deprecated` (see core/retired.ts). */
export const retiredSettings: readonly RetiredSetting[] = [
  { at: 'options.structure', to: 'options.variant', values: { byMeasure: 'by-measure', byMember: 'by-member' } },
  { at: 'options.preset', use: 'A dimswitch always draws the steering table.' },
  { at: 'options.order', values: { authored: 'sheet' } },
  ...['options.groupRule', 'options.groupAlign'].map((at) => ({ at, use: 'These keys set the head of a column group, and a dimswitch draws none.' })),
  { at: 'options.format', use: 'Set measures[].format.' },
  { at: 'options.density', values: { cohort: null, 'cohort-small': null },
    use: "A cohort density is a one-line row and a dimswitch cell holds two lines; set 'compact' for tight rows." },
];
